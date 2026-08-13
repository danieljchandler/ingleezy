import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { COLUMNS_MISSING_FROM_TYPES, extraColumnsFor } from "./typesDrift";

/**
 * The schema the in-memory PostgREST validates against.
 *
 * Rather than hand-maintaining a table/column registry that would immediately
 * rot, this parses `src/integrations/supabase/types.ts` — the file Supabase
 * generates from the live database. That makes the double's idea of the schema
 * the same one the app's own types come from, so a column renamed in a
 * migration and regenerated here is reflected in the test backend for free.
 *
 * The payoff is that the double can reject an unknown column exactly as
 * PostgREST does. Selecting a column that no longer exists is one of the most
 * common ways this app breaks — the query 400s, react-query surfaces an empty
 * list, and the page renders a plausible-looking empty state instead of an
 * error. A double that returns fixtures regardless of the select clause cannot
 * see that class of bug at all.
 */

export interface Relationship {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}

export interface TableSchema {
  name: string;
  /** Every column on the row. */
  columns: Set<string>;
  /** Columns with no default and no `?` in the Insert type. */
  requiredOnInsert: Set<string>;
  relationships: Relationship[];
}

export interface DatabaseSchema {
  tables: Map<string, TableSchema>;
}

const here = dirname(fileURLToPath(import.meta.url));
const TYPES_PATH = resolve(here, "../../../integrations/supabase/types.ts");

/** Pull the `Tables: { ... }` / `Views: { ... }` blocks out of the generated file. */
function sliceBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start === -1) return "";

  let depth = 0;
  let index = source.indexOf("{", start);
  const from = index;

  for (; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}") {
      depth--;
      if (depth === 0) return source.slice(from + 1, index);
    }
  }
  return "";
}

/**
 * Split a block into its `name: { ... }` entries.
 *
 * Advancing `lastIndex` past each entry's closing brace is what keeps the
 * nested `Row`/`Insert`/`Update`/`Relationships` keys from being mistaken for
 * table names — no indentation bookkeeping needed.
 */
function splitEntries(block: string): Array<{ name: string; body: string }> {
  const entries: Array<{ name: string; body: string }> = [];
  const pattern = /^\s*([A-Za-z_][A-Za-z0-9_]*): \{$/gm;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    let depth = 0;
    let index = block.indexOf("{", match.index);
    const from = index;

    for (; index < block.length; index++) {
      if (block[index] === "{") depth++;
      else if (block[index] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }

    entries.push({ name: match[1], body: block.slice(from + 1, index) });
    pattern.lastIndex = index;
  }

  return entries;
}

/** Read the property names out of a `Row: { ... }` / `Insert: { ... }` section. */
function parseFields(body: string, section: "Row" | "Insert"): {
  all: Set<string>;
  required: Set<string>;
} {
  const all = new Set<string>();
  const required = new Set<string>();

  const header = new RegExp(`^\\s*${section}: \\{$`, "m");
  const match = header.exec(body);
  if (!match) return { all, required };

  let depth = 0;
  let index = body.indexOf("{", match.index);
  const from = index;
  for (; index < body.length; index++) {
    if (body[index] === "{") depth++;
    else if (body[index] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }

  const section_body = body.slice(from + 1, index);
  const field = /^\s{0,20}([A-Za-z_][A-Za-z0-9_]*)(\?)?:\s/gm;
  let f: RegExpExecArray | null;
  while ((f = field.exec(section_body)) !== null) {
    all.add(f[1]);
    if (!f[2]) required.add(f[1]);
  }

  return { all, required };
}

function parseRelationships(body: string): Relationship[] {
  const relationships: Relationship[] = [];
  const blockMatch = /Relationships: \[(.*?)\n\s*\]/s.exec(body);
  if (!blockMatch) return relationships;

  const entryPattern =
    /foreignKeyName: "([^"]+)"\s*columns: \[([^\]]*)\]\s*(?:isOneToOne: (true|false)\s*)?referencedRelation: "([^"]+)"\s*referencedColumns: \[([^\]]*)\]/gs;

  const list = (raw: string) =>
    raw
      .split(",")
      .map((item) => item.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);

  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(blockMatch[1])) !== null) {
    relationships.push({
      foreignKeyName: match[1],
      columns: list(match[2]),
      isOneToOne: match[3] === "true",
      referencedRelation: match[4],
      referencedColumns: list(match[5]),
    });
  }

  return relationships;
}

let cached: DatabaseSchema | undefined;

/**
 * Columns as the generated types actually declare them, before typesDrift.ts
 * adds the ones the types are missing.
 *
 * Kept separate so `typesDrift.test.ts` can check that every entry on that list
 * is still genuinely absent — otherwise regenerating the types would leave the
 * list quietly accumulating dead entries.
 */
const declaredInTypes = new Map<string, Set<string>>();

export function columnsFromTypes(table: string): Set<string> | undefined {
  loadSchema();
  return declaredInTypes.get(table);
}

export function loadSchema(): DatabaseSchema {
  if (cached) return cached;

  const source = readFileSync(TYPES_PATH, "utf8");
  const tables = new Map<string, TableSchema>();

  for (const header of ["    Tables: {", "    Views: {"]) {
    const block = sliceBlock(source, header);
    if (!block) continue;

    for (const { name, body } of splitEntries(block)) {
      const row = parseFields(body, "Row");
      if (row.all.size === 0) continue;

      const insert = parseFields(body, "Insert");
      declaredInTypes.set(name, new Set(row.all));

      // The generated types are behind the migrations in 24 places; without
      // these the double would reject writes the real database accepts. See
      // typesDrift.ts.
      for (const column of extraColumnsFor(name)) row.all.add(column);

      tables.set(name, {
        name,
        columns: row.all,
        requiredOnInsert: insert.required,
        relationships: parseRelationships(body),
      });
    }
  }

  // Two tables are missing from the types entirely rather than column by column
  // — they carry no anon or authenticated grants, so the generator skips them.
  // Registering them from the drift list is what lets the schema-contract check
  // validate the columns the edge functions write.
  for (const { table, column } of COLUMNS_MISSING_FROM_TYPES) {
    if (declaredInTypes.has(table)) continue;

    let entry = tables.get(table);
    if (!entry) {
      entry = {
        name: table,
        columns: new Set<string>(),
        // No `Insert` type to read, so nothing is known to be required. Better
        // empty than guessed: a wrong entry here would reject a valid write.
        requiredOnInsert: new Set<string>(),
        relationships: [],
      };
      tables.set(table, entry);
    }
    entry.columns.add(column);
  }

  cached = { tables };
  return cached;
}

/**
 * Find the relationship that satisfies `parent(child(...))`.
 *
 * Checks both directions: `word_reviews(vocabulary_words(...))` follows a FK
 * held by the parent, while `lessons(vocabulary_words(...))` follows one held
 * by the child. `hint` disambiguates when two FKs connect the same pair, which
 * is what PostgREST's `!fk_name` syntax exists for.
 */
export function findRelationship(
  parentTable: string,
  childTable: string,
  hint?: string,
): { relationship: Relationship; direction: "parent-holds-fk" | "child-holds-fk" } | undefined {
  const schema = loadSchema();
  const parent = schema.tables.get(parentTable);
  const child = schema.tables.get(childTable);

  const matchesHint = (rel: Relationship) => !hint || rel.foreignKeyName === hint;

  const outbound = parent?.relationships.find(
    (rel) => rel.referencedRelation === childTable && matchesHint(rel),
  );
  if (outbound) return { relationship: outbound, direction: "parent-holds-fk" };

  const inbound = child?.relationships.find(
    (rel) => rel.referencedRelation === parentTable && matchesHint(rel),
  );
  if (inbound) return { relationship: inbound, direction: "child-holds-fk" };

  return undefined;
}

export function getTable(name: string): TableSchema | undefined {
  return loadSchema().tables.get(name);
}
