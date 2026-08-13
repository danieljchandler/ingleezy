import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Finds every table, column and RPC the app names in a Supabase query.
 *
 * Parsed with the TypeScript compiler API rather than a regex, because a query
 * is a chain — `.from("t").select("a, b").eq("c", x)` — and the table has to be
 * carried along it to make sense of the column names. The chains also span
 * many lines and use template literals.
 *
 * This is what makes a whole-app schema check possible: the app names ~37
 * tables and reads hundreds of columns, and a single renamed column produces a
 * PostgREST 400 that surfaces in the UI as an empty list rather than an error.
 */

export interface TableUsage {
  table: string;
  /** Columns named anywhere in the chain — in select, filters or order. */
  columns: Set<string>;
  /** Related tables named as embedded resources. */
  embeds: Set<string>;
  /** Where it was found, for the failure message. */
  locations: Set<string>;
}

export interface QueryInventory {
  tables: Map<string, TableUsage>;
  rpcs: Map<string, Set<string>>;
  functions: Map<string, Set<string>>;
}

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../../..");

/** Chain methods whose first string argument is a column name. */
const COLUMN_ARG_METHODS = new Set([
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
  "contains",
  "containedBy",
  "order",
]);

/** Chain methods whose first argument is a select list. */
const SELECT_METHODS = new Set(["select"]);

/** Chain methods whose first argument is an object of column/value pairs. */
const PAYLOAD_METHODS = new Set(["insert", "update", "upsert"]);

function walkFiles(dir: string, extensions: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkFiles(full, extensions, out);
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
}

/** Read a string literal or a template with no substitutions. */
function literalText(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  // `"a" as never` and similar casts are common in this codebase.
  if (ts.isAsExpression(node)) return literalText(node.expression);
  return undefined;
}

/**
 * Pull column names out of a `select=` list.
 *
 * Embedded resources are reported separately: `topics(name)` names a relation,
 * not a column of the parent.
 */
function parseSelectList(list: string): { columns: string[]; embeds: string[] } {
  const columns: string[] = [];
  const embeds: string[] = [];

  let depth = 0;
  let current = "";
  const flush = () => {
    const token = current.trim();
    current = "";
    if (!token || token === "*") return;

    const paren = token.indexOf("(");
    if (paren > -1) {
      // `alias:relation!inner(cols)` — take the relation name.
      const head = token.slice(0, paren);
      const relation = head.split(":").pop()?.split("!")[0]?.trim();
      if (relation) embeds.push(relation);

      // Recurse so a nested embed's columns are attributed to that relation,
      // not to the parent — handled by the caller via `embeds`.
      return;
    }

    // `alias:column` and `column->>json`.
    const withoutAlias = token.includes(":") ? token.split(":").pop()! : token;
    const column = withoutAlias.split("->")[0].trim();
    if (column && column !== "*" && /^[a-z_][a-z0-9_]*$/i.test(column)) columns.push(column);
  };

  for (const char of list) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === "," && depth === 0) {
      flush();
      continue;
    }
    current += char;
  }
  flush();

  return { columns, embeds };
}

/** Walk back up a call chain from a `.from()` call to collect what it names. */
function collectChain(
  fromCall: ts.CallExpression,
  usage: TableUsage,
): void {
  let node: ts.Node = fromCall;

  // Climb outward through `.select(...).eq(...)...`
  while (node.parent) {
    const parent: ts.Node = node.parent;

    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      const method = parent.name.text;
      const call = parent.parent;
      if (!ts.isCallExpression(call) || call.expression !== parent) {
        node = parent;
        continue;
      }

      const firstArg = call.arguments[0];

      if (SELECT_METHODS.has(method)) {
        const text = literalText(firstArg);
        if (text) {
          const { columns, embeds } = parseSelectList(text);
          for (const column of columns) usage.columns.add(column);
          for (const embed of embeds) usage.embeds.add(embed);
        }
      } else if (COLUMN_ARG_METHODS.has(method)) {
        const text = literalText(firstArg);
        // Embedded filters read `relation.column`; the column belongs to the
        // relation, so record the relation and leave the column to it.
        if (text && !text.includes(".")) usage.columns.add(text);
        else if (text) usage.embeds.add(text.split(".")[0]);
      } else if (PAYLOAD_METHODS.has(method)) {
        collectPayloadColumns(firstArg, usage);
      }

      node = call;
      continue;
    }

    break;
  }
}

/** Object-literal keys passed to insert/update/upsert are column names. */
function collectPayloadColumns(arg: ts.Node | undefined, usage: TableUsage): void {
  if (!arg) return;

  const fromObject = (object: ts.ObjectLiteralExpression) => {
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
        const name = property.name;
        if (ts.isIdentifier(name)) usage.columns.add(name.text);
        else if (ts.isStringLiteral(name)) usage.columns.add(name.text);
      }
    }
  };

  if (ts.isObjectLiteralExpression(arg)) fromObject(arg);
  else if (ts.isArrayLiteralExpression(arg)) {
    for (const element of arg.elements) {
      if (ts.isObjectLiteralExpression(element)) fromObject(element);
    }
  }
}

export function extractQueries(roots = ["src", "supabase/functions"]): QueryInventory {
  const inventory: QueryInventory = {
    tables: new Map(),
    rpcs: new Map(),
    functions: new Map(),
  };

  const files = roots.flatMap((root) =>
    walkFiles(resolve(REPO_ROOT, root), [".ts", ".tsx"]).filter(
      // Skip the test tree itself: its fixtures deliberately name columns that
      // do not have to exist, and the generated types are not a query.
      (file) => !file.includes("/test/") && !file.endsWith("types.ts") && !file.includes("_test"),
    ),
  );

  for (const file of files) {
    const relative = file.replace(`${REPO_ROOT}/`, "");
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const name = literalText(node.arguments[0]);

        // `supabase.storage.from("bucket")` shares the method name with
        // `supabase.from("table")` but names a storage bucket, which is not a
        // table and has no columns. Without this the check reports every bucket
        // as a missing table.
        const receiver = node.expression.expression;
        const isStorage =
          ts.isPropertyAccessExpression(receiver) && receiver.name.text === "storage";

        if (method === "from" && name && !isStorage) {
          let usage = inventory.tables.get(name);
          if (!usage) {
            usage = { table: name, columns: new Set(), embeds: new Set(), locations: new Set() };
            inventory.tables.set(name, usage);
          }
          usage.locations.add(relative);
          collectChain(node, usage);
        } else if (method === "rpc" && name) {
          const locations = inventory.rpcs.get(name) ?? new Set<string>();
          locations.add(relative);
          inventory.rpcs.set(name, locations);
        } else if (method === "invoke" && name) {
          const locations = inventory.functions.get(name) ?? new Set<string>();
          locations.add(relative);
          inventory.functions.set(name, locations);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return inventory;
}
