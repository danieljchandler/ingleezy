import { UnsupportedQueryError } from "./errors";
import type {
  Condition,
  EmbeddedSelect,
  FilterNode,
  FilterOp,
  OrderSpec,
  ParsedQuery,
  Row,
  SelectField,
} from "./types";

/** Query-string keys that are not column filters. */
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

const FILTER_OPS: ReadonlySet<string> = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "cs",
  "cd",
  "ov",
]);

/**
 * Operators PostgREST supports that this double does not. Listed explicitly so
 * the error message can say "not implemented" rather than "unknown", which is
 * the difference between a five-minute fix and a debugging session.
 */
const KNOWN_UNSUPPORTED: ReadonlySet<string> = new Set([
  "fts",
  "plfts",
  "phfts",
  "wfts",
  "sl",
  "sr",
  "nxl",
  "nxr",
  "adj",
  "match",
  "imatch",
  "all",
  "any",
]);

/**
 * Split on a separator, ignoring separators nested inside parentheses.
 * `select=id,topics(name,icon)` must split into two fields, not three.
 */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === '"' && input[i - 1] !== "\\") inQuotes = !inQuotes;

    if (!inQuotes) {
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === separator && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += char;
  }

  // A trailing separator marks an empty final segment, not a missing one:
  // `root=neq.` is how PostgREST spells "not equal to the empty string", and
  // dropping the empty tail turned that valid filter into an unparseable one.
  // An empty input still yields no parts.
  if (current !== "" || parts.length > 0) parts.push(current);
  return parts;
}

/** `col->>path` / `col->path` — PostgREST's JSON accessors. */
function splitJsonPath(token: string): { column: string; jsonPath: string[] } {
  if (!token.includes("->")) return { column: token, jsonPath: [] };
  const segments = token.split(/->>?/);
  return { column: segments[0], jsonPath: segments.slice(1) };
}

/**
 * Parse one `select=` entry.
 *
 * Handles `column`, `alias:column`, `col->>json`, `rel(a,b)`, `rel!inner(a)`,
 * `rel!fk_name(a)`, `alias:rel(a)` and `rel(count)`.
 */
function parseSelectField(token: string): SelectField {
  const trimmed = token.trim();

  const parenIndex = trimmed.indexOf("(");
  if (parenIndex === -1) {
    // Plain column, possibly aliased or with a JSON path.
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > -1) {
      const alias = trimmed.slice(0, colonIndex);
      const { column, jsonPath } = splitJsonPath(trimmed.slice(colonIndex + 1));
      return { alias, column, jsonPath };
    }
    const { column, jsonPath } = splitJsonPath(trimmed);
    // PostgREST names a JSON-path field after its last segment.
    return { alias: jsonPath.length > 0 ? jsonPath[jsonPath.length - 1] : column, column, jsonPath };
  }

  // Embedded resource.
  if (!trimmed.endsWith(")")) {
    throw new UnsupportedQueryError("this select clause", `unbalanced parentheses in "${trimmed}"`);
  }

  let head = trimmed.slice(0, parenIndex);
  const inner = trimmed.slice(parenIndex + 1, -1);

  let alias: string | undefined;
  const colonIndex = head.indexOf(":");
  if (colonIndex > -1) {
    alias = head.slice(0, colonIndex);
    head = head.slice(colonIndex + 1);
  }

  let isInner = false;
  let hint: string | undefined;
  const bangIndex = head.indexOf("!");
  if (bangIndex > -1) {
    const modifier = head.slice(bangIndex + 1);
    head = head.slice(0, bangIndex);
    if (modifier === "inner") isInner = true;
    else if (modifier === "left") isInner = false;
    else hint = modifier;
  }

  const table = head;
  const innerTokens = splitTopLevel(inner, ",").map((t) => t.trim()).filter(Boolean);
  const countOnly = innerTokens.length === 1 && innerTokens[0] === "count";

  const embed: EmbeddedSelect = {
    table,
    inner: isInner,
    hint,
    countOnly,
    fields: countOnly ? [] : innerTokens.map(parseSelectField),
    filters: [],
    order: [],
  };

  return { alias: alias ?? table, column: table, jsonPath: [], embed };
}

export function parseSelect(value: string | null): SelectField[] {
  // No `select=` means "every column", which the executor represents as [].
  if (!value || value.trim() === "" || value.trim() === "*") return [];

  // A bare `*` is kept rather than dropped: in `select=*, topics(name)` it is
  // what tells the executor to emit the parent's own columns alongside the
  // embed. Dropping it silently returned only the embed.
  return splitTopLevel(value, ",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token) =>
      token === "*" ? { alias: "*", column: "*", jsonPath: [] } : parseSelectField(token),
    );
}

/** Parse `column.op.value`, the form used inside `or=()` / `and=()`. */
function parseLogicalOperand(token: string): FilterNode {
  const trimmed = token.trim();

  const logicalMatch = /^(not\.)?(or|and)\((.*)\)$/s.exec(trimmed);
  if (logicalMatch) {
    const [, not, operator, inner] = logicalMatch;
    return {
      kind: "logical",
      operator: operator as "or" | "and",
      negated: Boolean(not),
      children: splitTopLevel(inner, ",").map(parseLogicalOperand),
    };
  }

  const segments = splitTopLevel(trimmed, ".");
  if (segments.length < 2) {
    throw new UnsupportedQueryError("this filter", `could not parse "${trimmed}"`);
  }

  const column = segments[0];
  let index = 1;
  let negated = false;
  if (segments[index] === "not") {
    negated = true;
    index++;
  }

  const op = segments[index];
  const value = segments.slice(index + 1).join(".");
  return buildCondition(column, op, value, negated);
}

function buildCondition(column: string, op: string, value: string, negated: boolean): Condition {
  if (KNOWN_UNSUPPORTED.has(op)) {
    throw new UnsupportedQueryError(`the "${op}" operator`, `used on column "${column}"`);
  }
  if (!FILTER_OPS.has(op)) {
    throw new UnsupportedQueryError(`the "${op}" operator`, `used on column "${column}" — unrecognised`);
  }
  return { kind: "condition", column, op: op as FilterOp, value, negated };
}

/** Parse one `?column=op.value` pair from the query string. */
export function parseFilterParam(key: string, rawValue: string): FilterNode {
  if (key === "or" || key === "and") {
    const stripped = rawValue.replace(/^\(/, "").replace(/\)$/, "");
    return {
      kind: "logical",
      operator: key,
      negated: false,
      children: splitTopLevel(stripped, ",").map(parseLogicalOperand),
    };
  }

  const segments = splitTopLevel(rawValue, ".");
  if (segments.length < 2) {
    throw new UnsupportedQueryError("this filter", `expected "op.value" for "${key}", got "${rawValue}"`);
  }

  let index = 0;
  let negated = false;
  if (segments[0] === "not") {
    negated = true;
    index = 1;
  }

  const op = segments[index];
  const value = segments.slice(index + 1).join(".");
  return buildCondition(key, op, value, negated);
}

export function parseOrder(value: string | null): OrderSpec[] {
  if (!value) return [];

  return splitTopLevel(value, ",").map((token) => {
    const parts = token.trim().split(".");
    const column = parts[0];
    const modifiers = parts.slice(1);

    const ascending = !modifiers.includes("desc");
    // PostgREST's default: nulls sort last ascending, first descending.
    const nullsFirst = modifiers.includes("nullsfirst")
      ? true
      : modifiers.includes("nullslast")
        ? false
        : !ascending;

    return { column, ascending, nullsFirst };
  });
}

/** `Prefer: count=exact, return=representation, resolution=merge-duplicates` */
function parsePrefer(header: string | null) {
  const prefer = (header ?? "").toLowerCase();
  const ignoreDuplicates = prefer.includes("resolution=ignore-duplicates");

  return {
    count: /count=(exact|planned|estimated)/.exec(prefer)?.[1] as ParsedQuery["count"],
    returning: prefer.includes("return=minimal") ? ("minimal" as const) : ("representation" as const),
    // Both resolutions mean "upsert"; they differ in what happens to a row
    // that already exists. Merging overwrites it, ignoring leaves it alone —
    // and, crucially, leaves it out of the returned representation. That
    // shorter result set is not cosmetic: it is how the app counts which of a
    // bulk save's words were new, which is what "Saved 3 — 2 already in My
    // Words" is derived from.
    upsert: prefer.includes("resolution=merge-duplicates") || ignoreDuplicates,
    ignoreDuplicates,
  };
}

/** `Range: 0-9` is how supabase-js expresses `.range(from, to)`. */
function parseRange(header: string | null): { offset?: number; limit?: number } {
  if (!header) return {};
  const match = /^(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return {};

  const from = Number(match[1]);
  const to = match[2] === "" ? undefined : Number(match[2]);
  return { offset: from, limit: to === undefined ? undefined : to - from + 1 };
}

export interface ParseInput {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: Row | Row[];
}

/**
 * Attach `?related.column=eq.x` to the embed it belongs to.
 *
 * PostgREST lets a filter target an embedded resource by prefixing the column
 * with the relation name, and the app relies on it: the grammar-mastery query
 * selects `curriculum_concepts!inner(...)` and then filters
 * `curriculum_concepts.kind=eq.grammar`. Treated as a plain column that would
 * be a nonexistent name, and treated as a no-op it would silently widen the
 * result to every concept kind.
 *
 * Returns true when the filter was claimed by an embed.
 */
function attachToEmbed(fields: SelectField[], key: string, rawValue: string): boolean {
  const separator = key.indexOf(".");
  if (separator === -1) return false;

  const prefix = key.slice(0, separator);
  const rest = key.slice(separator + 1);

  const field = fields.find(
    (candidate) =>
      candidate.embed && (candidate.alias === prefix || candidate.embed.table === prefix),
  );
  if (!field?.embed) return false;

  // Deeper nesting resolves against the embed's own fields.
  if (attachToEmbed(field.embed.fields, rest, rawValue)) return true;

  field.embed.filters.push(parseFilterParam(rest, rawValue));
  return true;
}

export function parseQuery({ method, url, headers, body }: ParseInput): ParsedQuery {
  const table = url.pathname.replace(/^.*\/rest\/v1\//, "").split("?")[0];
  const params = url.searchParams;

  const fields = parseSelect(params.get("select"));

  const filters: FilterNode[] = [];
  for (const [key, value] of params.entries()) {
    if (RESERVED.has(key)) continue;
    if (attachToEmbed(fields, key, value)) continue;
    filters.push(parseFilterParam(key, value));
  }

  const prefer = parsePrefer(headers["prefer"] ?? null);
  const range = parseRange(headers["range"] ?? null);

  const limitParam = params.get("limit");
  const offsetParam = params.get("offset");

  return {
    method: method.toUpperCase() as ParsedQuery["method"],
    table,
    fields,
    filters,
    order: parseOrder(params.get("order")),
    limit: limitParam !== null ? Number(limitParam) : range.limit,
    offset: offsetParam !== null ? Number(offsetParam) : range.offset,
    count: prefer.count,
    // Both .single() and .maybeSingle() ask for this content type.
    single: (headers["accept"] ?? "").includes("pgrst.object"),
    returning: prefer.returning,
    upsert: prefer.upsert,
    ignoreDuplicates: prefer.ignoreDuplicates,
    onConflict: params.get("on_conflict")?.split(",").map((c) => c.trim()),
    body,
  };
}
