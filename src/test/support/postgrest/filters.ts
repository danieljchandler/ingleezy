import { UnsupportedQueryError } from "./errors";
import type { Condition, FilterNode, OrderSpec, Row } from "./types";

/** Read a column, following a `->>`/`->` JSON path if one was given. */
export function readValue(row: Row, column: string, jsonPath: string[] = []): unknown {
  let value: unknown = row[column];
  for (const segment of jsonPath) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") return null;
    value = (value as Record<string, unknown>)[segment];
  }
  return value === undefined ? null : value;
}

/**
 * Decode a filter operand.
 *
 * PostgREST is a text protocol, so `.eq("count", 3)` and `.eq("name", "3")`
 * arrive identically. Comparison therefore coerces rather than requiring the
 * fixture's type to match what the caller passed.
 */
function decodeScalar(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  // PostgREST quotes values containing reserved characters.
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) return raw.slice(1, -1);
  return raw;
}

/** `in.(a,b,c)` — the parens are part of the wire format. */
function decodeList(raw: string): unknown[] {
  const stripped = raw.replace(/^\(/, "").replace(/\)$/, "");
  if (stripped === "") return [];
  return stripped.split(",").map((item) => decodeScalar(item.trim()));
}

/** Compare loosely across the string/number/date boundary the wire format erases. */
function compare(left: unknown, right: unknown): number | null {
  if (left === null || left === undefined || right === null || right === undefined) return null;

  if (typeof left === "number" || typeof right === "number") {
    const a = Number(left);
    const b = Number(right);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a < b ? -1 : a > b ? 1 : 0;
  }

  const a = String(left);
  const b = String(right);

  // ISO timestamps compare correctly as strings only when both are the same
  // shape; parse them so "2026-01-01" vs "2026-01-01T00:00:00Z" behaves.
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  const looksLikeDate = /^\d{4}-\d{2}-\d{2}/.test(a) && /^\d{4}-\d{2}-\d{2}/.test(b);
  if (looksLikeDate && !Number.isNaN(aTime) && !Number.isNaN(bTime)) {
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  }

  return a < b ? -1 : a > b ? 1 : 0;
}

function looseEquals(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left === "boolean" || typeof right === "boolean") {
    return String(left) === String(right);
  }
  return compare(left, right) === 0;
}

/** `like`/`ilike` use `*` as the wildcard on the wire, not `%`. */
function patternToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, caseInsensitive ? "i" : "");
}

function evaluateCondition(row: Row, condition: Condition): boolean {
  const { column, op, value, negated } = condition;
  const actual = readValue(row, column);
  let result: boolean;

  switch (op) {
    case "eq":
      result = looseEquals(actual, decodeScalar(value));
      break;
    case "neq":
      result = !looseEquals(actual, decodeScalar(value));
      break;
    case "gt": {
      const c = compare(actual, decodeScalar(value));
      result = c !== null && c > 0;
      break;
    }
    case "gte": {
      const c = compare(actual, decodeScalar(value));
      result = c !== null && c >= 0;
      break;
    }
    case "lt": {
      const c = compare(actual, decodeScalar(value));
      result = c !== null && c < 0;
      break;
    }
    case "lte": {
      const c = compare(actual, decodeScalar(value));
      result = c !== null && c <= 0;
      break;
    }
    case "like":
      result = typeof actual === "string" && patternToRegExp(value, false).test(actual);
      break;
    case "ilike":
      result = typeof actual === "string" && patternToRegExp(value, true).test(actual);
      break;
    case "is": {
      const expected = decodeScalar(value);
      // `is` is the null/boolean identity check; it never coerces.
      result = actual === expected;
      break;
    }
    case "in":
      result = decodeList(value).some((candidate) => looseEquals(actual, candidate));
      break;
    case "cs":
      // Array contains: every listed element is present.
      result =
        Array.isArray(actual) &&
        decodeList(value).every((candidate) =>
          (actual as unknown[]).some((item) => looseEquals(item, candidate)),
        );
      break;
    case "cd":
      // Array contained by.
      result =
        Array.isArray(actual) &&
        (actual as unknown[]).every((item) =>
          decodeList(value).some((candidate) => looseEquals(item, candidate)),
        );
      break;
    case "ov":
      // Arrays overlap.
      result =
        Array.isArray(actual) &&
        decodeList(value).some((candidate) =>
          (actual as unknown[]).some((item) => looseEquals(item, candidate)),
        );
      break;
    default:
      throw new UnsupportedQueryError(`the "${op}" operator`, `on column "${column}"`);
  }

  return negated ? !result : result;
}

export function evaluateFilter(row: Row, node: FilterNode): boolean {
  if (node.kind === "condition") return evaluateCondition(row, node);

  const result =
    node.operator === "or"
      ? node.children.some((child) => evaluateFilter(row, child))
      : node.children.every((child) => evaluateFilter(row, child));

  return node.negated ? !result : result;
}

export function applyFilters(rows: Row[], filters: FilterNode[]): Row[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) => filters.every((filter) => evaluateFilter(row, filter)));
}

export function applyOrder(rows: Row[], order: OrderSpec[]): Row[] {
  if (order.length === 0) return rows;

  // Copy first: callers hold references to the store's arrays.
  return [...rows].sort((left, right) => {
    for (const spec of order) {
      const a = readValue(left, spec.column);
      const b = readValue(right, spec.column);

      const aNull = a === null || a === undefined;
      const bNull = b === null || b === undefined;
      if (aNull && bNull) continue;
      if (aNull) return spec.nullsFirst ? -1 : 1;
      if (bNull) return spec.nullsFirst ? 1 : -1;

      const c = compare(a, b) ?? 0;
      if (c !== 0) return spec.ascending ? c : -c;
    }
    return 0;
  });
}
