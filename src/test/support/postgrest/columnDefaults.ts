import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/**
 * Literal column defaults, read out of the migrations.
 *
 * Postgres fills these in on insert; the in-memory backend has to as well, or
 * a page that omits a defaulted column reads it back as `undefined`. That is
 * not a harmless difference — `invite_codes.uses` defaults to 0 and the admin
 * console renders `{uses}/{max_uses} used`, so a freshly created code showed
 * "/1 used" in the double and "0/1 used" in production. The failure mode is
 * always this shape: something that is never null in reality reads as missing,
 * and only in the tests.
 *
 * Deliberately limited to *literal* defaults — numbers, quoted strings,
 * booleans. Function calls (`now()`, `gen_random_uuid()`, `auth.uid()`) are
 * either handled separately in `withDefaults` or are not reproducible here, and
 * guessing at them would be worse than leaving the column absent.
 *
 * The generated types cannot supply this. They mark a column optional on
 * insert when it has a default *or* is nullable, and they never record what the
 * default is — so the migrations are the only source.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../../supabase/migrations");

export type ColumnDefaults = Map<string, Map<string, unknown>>;

let cache: ColumnDefaults | undefined;

/** `'text'` → "text", `42` → 42, `true` → true. Anything else → undefined. */
function parseLiteral(raw: string): unknown {
  const value = raw.trim().replace(/::[\w\s.]+$/, "").trim();

  if (/^'([^']*)'$/.test(value)) return value.slice(1, -1);
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d*\.\d+$/.test(value)) return Number(value);
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  // `'{}'::jsonb` and `'[]'::jsonb` arrive here already stripped of the cast.
  return undefined;
}

/** Split a CREATE TABLE body on commas that are not inside parentheses. */
function splitColumns(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of body) {
    if (char === "(") depth++;
    else if (char === ")") depth--;

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const CONSTRAINT_LINE = /^\s*(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)\b/i;

function recordDefault(
  defaults: ColumnDefaults,
  table: string,
  column: string,
  raw: string,
): void {
  const value = parseLiteral(raw);
  if (value === undefined) return;

  let columns = defaults.get(table);
  if (!columns) {
    columns = new Map();
    defaults.set(table, columns);
  }
  // Later migrations win: a `SET DEFAULT` after the fact is the current value.
  columns.set(column, value);
}

function load(): ColumnDefaults {
  const defaults: ColumnDefaults = new Map();

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  } catch {
    // No migrations reachable (a consumer running outside the repo). The
    // backend still works; it just fills in fewer columns.
    return defaults;
  }

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    for (const match of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi,
    )) {
      const table = match[1];
      for (const line of splitColumns(match[2])) {
        if (CONSTRAINT_LINE.test(line)) continue;
        const column = /^\s*"?(\w+)"?\s/.exec(line)?.[1];
        // `DEFAULT <literal>` up to the next keyword or end of the definition.
        const value = /\bDEFAULT\s+([^\s,]+(?:\s*::[\w\s.]+)?)/i.exec(line)?.[1];
        if (column && value) recordDefault(defaults, table, column, value);
      }
    }

    for (const match of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?[^;]*?\bDEFAULT\s+([^\s,;]+(?:\s*::[\w\s.]+)?)/gi,
    )) {
      recordDefault(defaults, match[1], match[2], match[3]);
    }

    for (const match of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s+ALTER\s+COLUMN\s+"?(\w+)"?\s+SET\s+DEFAULT\s+([^\s,;]+(?:\s*::[\w\s.]+)?)/gi,
    )) {
      recordDefault(defaults, match[1], match[2], match[3]);
    }

    // Renames, applied after this file's other statements so a table created
    // and renamed in one migration lands under its final name.
    //
    // Without this a renamed table silently loses every default it had: the
    // defaults are filed under the CREATE TABLE name, nothing ever looks them
    // up under the new one, and the emulator starts leaving columns null that
    // the real database fills. That is invisible until a test asserts on a
    // defaulted column and gets undefined.
    for (const match of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s+RENAME\s+TO\s+"?(\w+)"?/gi,
    )) {
      const [, from, to] = match;
      const columns = defaults.get(from);
      if (columns) {
        defaults.set(to, columns);
        defaults.delete(from);
      }
    }

    for (const match of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s+RENAME\s+(?:COLUMN\s+)?"?(\w+)"?\s+TO\s+"?(\w+)"?/gi,
    )) {
      const [, table, from, to] = match;
      const columns = defaults.get(table);
      if (columns?.has(from)) {
        columns.set(to, columns.get(from));
        columns.delete(from);
      }
    }
  }

  return defaults;
}

/** Literal defaults for `table`, keyed by column. Empty when there are none. */
export function defaultsFor(table: string): Map<string, unknown> {
  cache ??= load();
  return cache.get(table) ?? new Map();
}
