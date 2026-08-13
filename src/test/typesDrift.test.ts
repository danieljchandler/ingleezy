import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLUMNS_MISSING_FROM_TYPES,
  type DriftedColumn,
} from "./support/postgrest/typesDrift";
import { columnsFromTypes, getTable } from "./support/postgrest/schema";

/**
 * Keeps the drift list honest.
 *
 * `typesDrift.ts` tells the test backend to accept columns that
 * `src/integrations/supabase/types.ts` does not know about. That is a hole in
 * the strongest check the suite has — the emulator otherwise rejects an unknown
 * column exactly as PostgREST does, which is what catches a fixture inventing a
 * field and then silently matching nothing.
 *
 * So each entry has to earn its place: the migration it names must exist, must
 * genuinely create that column on that table, and the column must still be
 * absent from the generated types. Misspell a column and the migration check
 * fails; regenerate the types and the staleness check tells you to delete the
 * entry rather than leaving it to rot.
 */

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

function migrationSource(entry: DriftedColumn): string | undefined {
  const path = `${MIGRATIONS}/${entry.migration}.sql`;
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/**
 * Does this migration create `column` on `table`?
 *
 * Two shapes cover every entry: `ALTER TABLE ... ADD COLUMN [IF NOT EXISTS] x`,
 * and a bare `x TYPE` line inside the table's `CREATE TABLE` body. Matching the
 * CREATE TABLE body rather than the whole file is what stops a column name that
 * merely appears in a comment or a different table from counting.
 */
function createsColumn(sql: string, table: string, column: string): boolean {
  const name = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const created = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  ).exec(sql);
  if (created && new RegExp(`^\\s*${name}\\s+\\w`, "im").test(created[1])) return true;

  // `ALTER TABLE t ADD COLUMN a ..., ADD COLUMN b ...;` — one statement, so the
  // table name and the column can be several lines apart.
  const altered = new RegExp(
    `ALTER TABLE (?:ONLY )?(?:public\\.)?${table}\\s+([\\s\\S]*?);`,
    "gi",
  );
  let statement: RegExpExecArray | null;
  while ((statement = altered.exec(sql)) !== null) {
    if (new RegExp(`ADD COLUMN\\s+(?:IF NOT EXISTS\\s+)?${name}\\b`, "i").test(statement[1])) {
      return true;
    }
  }

  return false;
}

describe("the generated Supabase types are stale in a known, pinned set of places", () => {
  it("lists something — otherwise the plumbing in schema.ts is dead code", () => {
    expect(COLUMNS_MISSING_FROM_TYPES.length).toBeGreaterThan(0);
  });

  it("has no duplicate entries", () => {
    const keys = COLUMNS_MISSING_FROM_TYPES.map((e) => `${e.table}.${e.column}`);
    expect(keys).toEqual([...new Set(keys)]);
  });

  describe.each(COLUMNS_MISSING_FROM_TYPES.map((entry) => [`${entry.table}.${entry.column}`, entry] as const))("%s", (_label, entry) => {
    it(`is created by ${entry.migration}`, () => {
      const sql = migrationSource(entry);
      expect(sql, `supabase/migrations/${entry.migration}.sql does not exist`).toBeDefined();
      expect(
        createsColumn(sql as string, entry.table, entry.column),
        `${entry.migration}.sql does not add "${entry.column}" to "${entry.table}". ` +
          `Either the column name is a typo, or the entry names the wrong migration.`,
      ).toBe(true);
    });

    it("is still missing from the generated types", () => {
      const declared = columnsFromTypes(entry.table);
      // A table absent from the types entirely — the service-role-only ones —
      // has nothing to be stale about.
      if (!declared) return;

      expect(
        declared.has(entry.column),
        `"${entry.column}" is now in types.ts for "${entry.table}". Delete this ` +
          `entry from COLUMNS_MISSING_FROM_TYPES — the drift it documents is fixed.`,
      ).toBe(false);
    });

    it("is accepted by the test backend", () => {
      // The point of the list. Without this the emulator would 400 a write the
      // real database takes, and the failure would look like an app bug.
      expect(getTable(entry.table)?.columns.has(entry.column)).toBe(true);
    });
  });
});
