import { defaultsFor } from "./columnDefaults";
import { errors, UnsupportedQueryError } from "./errors";
import { applyFilters, applyOrder, readValue } from "./filters";
import { findRelationship, getTable } from "./schema";
import type { MemoryDb } from "./store";
import type { EmbeddedSelect, ExecuteResult, ParsedQuery, Row, SelectField } from "./types";

const JSON_HEADERS = { "content-type": "application/json" };

function fail(status: number, body: unknown): ExecuteResult {
  return { status, body, headers: JSON_HEADERS };
}

/**
 * `content-range` is how PostgREST reports `{ count: "exact" }`.
 *
 * It is not a CORS-safelisted response header, so the transports must also send
 * `access-control-expose-headers`. Without that the browser hides it from
 * supabase-js and every count in the app silently reads as zero — a failure
 * mode that looks exactly like "there is no data".
 */
function contentRange(rows: number, total: number | undefined): string {
  const range = rows > 0 ? `0-${rows - 1}` : "*";
  return `${range}/${total ?? "*"}`;
}

/** Resolve an embedded resource for one parent row. */
function resolveEmbed(db: MemoryDb, parentTable: string, parent: Row, embed: EmbeddedSelect): unknown {
  const link = findRelationship(parentTable, embed.table, embed.hint);
  if (!link) {
    throw new EmbedError(errors.noRelationship(parentTable, embed.table));
  }

  const { relationship, direction } = link;
  const childRows = db.raw(embed.table);

  let matches: Row[];
  if (direction === "parent-holds-fk") {
    // parent.<column> -> child.<referencedColumn>
    const key = readValue(parent, relationship.columns[0]);
    matches =
      key === null || key === undefined
        ? []
        : childRows.filter((child) => readValue(child, relationship.referencedColumns[0]) === key);
  } else {
    // child.<column> -> parent.<referencedColumn>
    const key = readValue(parent, relationship.referencedColumns[0]);
    matches =
      key === null || key === undefined
        ? []
        : childRows.filter((child) => readValue(child, relationship.columns[0]) === key);
  }

  matches = applyFilters(matches, embed.filters);
  matches = applyOrder(matches, embed.order);
  if (embed.limit !== undefined) matches = matches.slice(0, embed.limit);

  if (embed.countOnly) return [{ count: matches.length }];

  const projected = matches.map((child) => project(db, embed.table, child, embed.fields));

  // A to-one relationship yields an object (or null); to-many yields an array.
  // PostgREST decides by which side holds the FK, and the app relies on it:
  // `lessons(title)` on a word is an object, `vocabulary_words(id)` on a lesson
  // is an array.
  const toOne = direction === "parent-holds-fk";
  if (toOne) return projected[0] ?? null;
  return projected;
}

/** Raised inside projection so the executor can turn it into a PostgREST error. */
class EmbedError extends Error {
  constructor(public readonly body: ReturnType<typeof errors.noRelationship>) {
    super(body.message);
    this.name = "EmbedError";
  }
}

/** Apply a `select=` list to one row. */
function project(db: MemoryDb, table: string, row: Row, fields: SelectField[]): Row {
  // No select clause means every column, which is what `select()` sends.
  if (fields.length === 0) return { ...row };

  const output: Row = {};
  const schema = getTable(table);

  for (const field of fields) {
    if (field.embed) {
      output[field.alias] = resolveEmbed(db, table, row, field.embed);
      continue;
    }

    if (field.column === "*") {
      Object.assign(output, row);
      continue;
    }

    // Reject unknown columns the way PostgREST does. This is the check that
    // turns a renamed column into a failing test rather than an empty list.
    if (schema && !schema.columns.has(field.column)) {
      throw new EmbedError(errors.undefinedColumn(table, field.column));
    }

    output[field.alias] = readValue(row, field.column, field.jsonPath);
  }

  return output;
}

/** `select=*, other(...)` — `*` appears as a bare field alongside embeds. */
function hasStar(fields: SelectField[]): boolean {
  return fields.some((field) => field.column === "*" && !field.embed);
}

function projectAll(db: MemoryDb, table: string, rows: Row[], fields: SelectField[]): Row[] {
  if (fields.length === 0) return rows.map((row) => ({ ...row }));

  return rows.map((row) => {
    const projected = project(db, table, row, fields.filter((f) => f.column !== "*" || f.embed));
    return hasStar(fields) ? { ...row, ...projected } : projected;
  });
}

/**
 * Drop parents whose `!inner` embed matched nothing.
 *
 * The app depends on this: GrammarDrills selects
 * `user_concept_mastery` with `curriculum_concepts!inner(...)`, and a double
 * that treated `!inner` as a left join would show mastery rows for concepts
 * that no longer exist.
 */
function applyInnerJoins(projected: Row[], fields: SelectField[]): Row[] {
  const innerFields = fields.filter((field) => field.embed?.inner);
  if (innerFields.length === 0) return projected;

  return projected.filter((row) =>
    innerFields.every((field) => {
      const value = row[field.alias];
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined;
    }),
  );
}

function generateId(): string {
  // Deterministic enough for fixtures, unique enough for a test run.
  return "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padStart(12, "0");
}

/** Fill in the defaults Postgres would supply. */
function withDefaults(table: string, row: Row): Row {
  const schema = getTable(table);
  const filled: Row = { ...row };

  if (schema?.columns.has("id") && filled.id === undefined) filled.id = generateId();
  const now = new Date().toISOString();
  if (schema?.columns.has("created_at") && filled.created_at === undefined) filled.created_at = now;
  if (schema?.columns.has("updated_at") && filled.updated_at === undefined) filled.updated_at = now;

  return filled;
}

/**
 * Literal defaults from the migrations, applied only to a genuinely new row.
 *
 * Without these a page that omits a defaulted column on insert — which is the
 * whole point of having a default — reads it back as `undefined` and renders a
 * hole. But they must not touch the update half of an upsert: `ON CONFLICT DO
 * UPDATE` sets only the columns named, so folding defaults in before the merge
 * would overwrite a lesson's stored `words_total` with 0 and demote a
 * `completed` lesson back to its default status. Postgres defaults an absent
 * column on INSERT and leaves it alone on UPDATE, and so does this.
 */
function withColumnDefaults(table: string, row: Row): Row {
  const filled: Row = { ...row };
  for (const [column, value] of defaultsFor(table)) {
    if (filled[column] === undefined) filled[column] = value;
  }
  return filled;
}

function asRows(body: ParsedQuery["body"]): Row[] {
  if (body === undefined || body === null) return [];
  return Array.isArray(body) ? body : [body];
}

export function execute(db: MemoryDb, query: ParsedQuery): ExecuteResult {
  const { table, method } = query;

  // Injected failure takes precedence over everything.
  const isWrite = method !== "GET" && method !== "HEAD";
  const failure = db.takeFailure(table, isWrite, method);
  if (failure) {
    return fail(
      failure.status,
      failure.body ?? {
        code: String(failure.status),
        message: `Injected failure for ${table}`,
        details: null,
        hint: null,
      },
    );
  }

  const schema = getTable(table);
  if (!schema && !db.has(table)) {
    // Unknown to both the generated types and the fixtures: almost certainly a
    // typo, and PostgREST would say so too.
    return fail(404, errors.undefinedTable(table));
  }

  try {
    switch (method) {
      case "GET":
      case "HEAD":
        return read(db, query);
      case "POST":
        return insert(db, query);
      case "PATCH":
        return update(db, query);
      case "DELETE":
        return remove(db, query);
      case "PUT":
        return insert(db, { ...query, upsert: true });
      default:
        throw new UnsupportedQueryError(`the ${method} method`, `on table "${table}"`);
    }
  } catch (error) {
    if (error instanceof EmbedError) return fail(400, error.body);
    throw error;
  }
}

/**
 * Check every embed resolves before projecting any rows.
 *
 * PostgREST validates the select clause against the schema cache, so an embed
 * naming a relationship that does not exist fails whether or not the table has
 * rows. Validating lazily during projection meant an empty table returned 200
 * and an empty list — hiding the broken query behind an empty state, which is
 * precisely the failure this double exists to expose.
 */
function validateEmbeds(table: string, fields: SelectField[]): void {
  for (const field of fields) {
    if (!field.embed) continue;
    if (!findRelationship(table, field.embed.table, field.embed.hint)) {
      throw new EmbedError(errors.noRelationship(table, field.embed.table));
    }
    validateEmbeds(field.embed.table, field.embed.fields);
  }
}

function read(db: MemoryDb, query: ParsedQuery): ExecuteResult {
  const { table, fields, filters, order, limit, offset, count, single, method } = query;

  validateEmbeds(table, fields);

  const filtered = applyFilters(db.raw(table), filters);
  const ordered = applyOrder(filtered, order);

  const start = offset ?? 0;
  const windowed = limit === undefined ? ordered.slice(start) : ordered.slice(start, start + limit);

  const projected = applyInnerJoins(projectAll(db, table, windowed, fields), fields);

  // `!inner` filters after projection, so the total has to account for it too.
  const total =
    count === undefined
      ? undefined
      : applyInnerJoins(projectAll(db, table, ordered, fields), fields).length;

  const headers: Record<string, string> = {
    ...JSON_HEADERS,
    "content-range": contentRange(projected.length, total),
  };

  // head:true carries the count on the header and sends no body.
  if (method === "HEAD") return { status: 200, body: null, headers };

  if (single) {
    if (projected.length !== 1) {
      // .maybeSingle() keys its null-data path off this exact code.
      return { status: 406, body: errors.notSingle(projected.length), headers };
    }
    return { status: 200, body: projected[0], headers };
  }

  return { status: 200, body: projected, headers };
}

function insert(db: MemoryDb, query: ParsedQuery): ExecuteResult {
  const { table, fields, returning, upsert, ignoreDuplicates, onConflict, single } = query;
  const rows = db.raw(table);
  const incoming = asRows(query.body);
  const schema = getTable(table);

  const affected: Row[] = [];

  for (const raw of incoming) {
    const candidate = withDefaults(table, raw);

    if (schema) {
      const unknown = Object.keys(raw).find((column) => !schema.columns.has(column));
      if (unknown !== undefined) {
        return fail(400, errors.unknownColumnInPayload(table, unknown));
      }

      const missing = [...schema.requiredOnInsert].filter(
        (column) => candidate[column] === undefined || candidate[column] === null,
      );
      if (missing.length > 0) {
        return fail(400, errors.notNullViolation(table, missing[0]));
      }
    }

    const conflictColumns = onConflict ?? ["id"];
    const existingIndex = rows.findIndex((row) =>
      conflictColumns.every((column) => row[column] === candidate[column]),
    );

    if (existingIndex > -1) {
      if (!upsert) {
        return fail(409, errors.uniqueViolation(table, conflictColumns[0]));
      }
      if (ignoreDuplicates) {
        // Left untouched, and deliberately left out of `affected` — PostgREST
        // returns only the rows it actually wrote. Callers doing bulk saves
        // subtract that from what they sent to report how many were already
        // there, so including it here would make every duplicate look new.
        continue;
      }
      rows[existingIndex] = { ...rows[existingIndex], ...candidate };
      affected.push(rows[existingIndex]);
    } else {
      const inserted = withColumnDefaults(table, candidate);
      rows.push(inserted);
      // The same object, so `Prefer: return=representation` answers with the
      // defaults the row actually got rather than the payload it was sent.
      affected.push(inserted);
    }
  }

  db.recordWrite({
    table,
    method: "POST",
    payload: incoming,
    affected: affected.map((row) => ({ ...row })),
    at: Date.now(),
  });

  return respondToWrite(db, query, affected, returning, single, fields);
}

function update(db: MemoryDb, query: ParsedQuery): ExecuteResult {
  const { table, filters, fields, returning, single } = query;
  const rows = db.raw(table);
  const patch = asRows(query.body)[0] ?? {};

  const schema = getTable(table);
  if (schema) {
    const unknown = Object.keys(patch).find((column) => !schema.columns.has(column));
    if (unknown !== undefined) {
      return fail(400, errors.unknownColumnInPayload(table, unknown));
    }
  }

  const affected: Row[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (!applyFilters([rows[index]], filters).length) continue;
    rows[index] = { ...rows[index], ...patch };
    affected.push(rows[index]);
  }

  db.recordWrite({
    table,
    method: "PATCH",
    payload: [patch],
    affected: affected.map((row) => ({ ...row })),
    at: Date.now(),
  });

  return respondToWrite(db, query, affected, returning, single, fields);
}

function remove(db: MemoryDb, query: ParsedQuery): ExecuteResult {
  const { table, filters, fields, returning, single } = query;
  const rows = db.raw(table);

  const affected: Row[] = [];
  for (let index = rows.length - 1; index >= 0; index--) {
    if (!applyFilters([rows[index]], filters).length) continue;
    affected.unshift(rows[index]);
    rows.splice(index, 1);
  }

  db.recordWrite({
    table,
    method: "DELETE",
    payload: [],
    affected: affected.map((row) => ({ ...row })),
    at: Date.now(),
  });

  return respondToWrite(db, query, affected, returning, single, fields);
}

function respondToWrite(
  db: MemoryDb,
  query: ParsedQuery,
  affected: Row[],
  returning: ParsedQuery["returning"],
  single: boolean,
  fields: SelectField[],
): ExecuteResult {
  const headers: Record<string, string> = {
    ...JSON_HEADERS,
    "content-range": contentRange(affected.length, query.count ? affected.length : undefined),
  };

  if (returning === "minimal") return { status: 204, body: null, headers };

  const projected = projectAll(db, query.table, affected, fields);

  if (single) {
    if (projected.length !== 1) {
      return { status: 406, body: errors.notSingle(projected.length), headers };
    }
    return { status: 200, body: projected[0], headers };
  }

  return { status: query.method === "POST" ? 201 : 200, body: projected, headers };
}
