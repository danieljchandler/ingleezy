import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { extractQueries } from "./support/contract/extractQueries";
import { getTable, loadSchema } from "./support/postgrest/schema";

/**
 * Every table, column, RPC and edge function the app names, checked against the
 * schema Supabase generated from the live database.
 *
 * This is the check the in-memory backend cannot make. It answers "does the
 * thing the app asks for exist", which is the failure this app is most exposed
 * to: a renamed or dropped column makes PostgREST return 400, react-query
 * surfaces an empty array, and the page renders a plausible empty state. No
 * error, no crash, no test failure — just a feature that quietly stops working.
 *
 * Needs no database. It compares two artifacts already in the repo, so it runs
 * in the fast unit job on every push.
 */

const REPO_ROOT = resolve(__dirname, "../..");
const inventory = extractQueries();
const schema = loadSchema();

/**
 * Tables that migrations create but the generated types omit.
 *
 * Both are written only by edge functions under the service role and carry no
 * grants for anon or authenticated, which is why Supabase's type generator
 * leaves them out — the browser client genuinely cannot see them. Confirmed
 * present by replaying the migrations against a stock Postgres.
 *
 * Listed so the check does not report them as missing while still failing on a
 * table that is genuinely absent.
 */
const SERVICE_ROLE_ONLY_TABLES = new Set([
  "fanar_usage",
  "llm_usage_logs",
  "voice_usage",
  // Was itself untracked until 20260812103000 gave it a migration — the
  // "rebuilt database makes everyone look free-tier" debt.
  "subscribers",
  // The training-data flywheel's canonical store: written by edge functions
  // and a DB trigger, read by admins and the export script.
  "training_examples",
  // The semantic index (pgvector). Guarded migration — absent entirely on a
  // database without the extension — and reached only through edge functions.
  "content_embeddings",
  // Referrals (D4): codes and redemptions are written by the referral
  // function and read by the payments functions, all under the service role.
  "referral_codes",
  "referral_redemptions",
  // Paid native feedback (D2): ledger and requests, all through the
  // native-feedback function; the settle trigger writes the answers.
  "native_feedback_credits",
  "native_feedback_requests",
  // Recurring placement (C4): the trajectory, written only by placement-quiz
  // at scoring time so a charted level is always one the assessment produced.
  "placement_history",
]);

describe("tables", () => {
  it("finds the queries to check", () => {
    // A floor, so a broken extractor shows up as a failure here rather than as
    // an unexpectedly clean run everywhere else.
    expect(inventory.tables.size).toBeGreaterThan(30);
  });

  it("every table the app queries exists in the schema", () => {
    const missing = [...inventory.tables.values()]
      .filter((usage) => !schema.tables.has(usage.table) && !SERVICE_ROLE_ONLY_TABLES.has(usage.table))
      .map((usage) => `${usage.table} (from ${[...usage.locations].slice(0, 2).join(", ")})`);

    expect(missing).toEqual([]);
  });

  it("the service-role-only tables really are created by a migration", () => {
    // Otherwise the allowance above would quietly excuse a table that does not
    // exist anywhere.
    const migrations = readdirSync(resolve(REPO_ROOT, "supabase/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(resolve(REPO_ROOT, "supabase/migrations", file), "utf8"))
      .join("\n");

    for (const table of SERVICE_ROLE_ONLY_TABLES) {
      expect(
        new RegExp(`create table[^;]*\\b${table}\\b`, "is").test(migrations),
        `${table} is excused from the schema check but no migration creates it`,
      ).toBe(true);
    }
  });

  it("every table the app queries is created by a migration, not just present in the types", () => {
    // There used to be an allowance list here — tables that existed in
    // production but in no migration, recorded because writing the missing
    // migrations meant guessing at columns only production knew. It is gone:
    // the shapes came off the generated types, and 20260529150400 and
    // 20260822090000 author all five.
    //
    // This test is what stops the list coming back. The types file describes
    // the database as it *is*, so a table someone adds through the dashboard
    // passes every other check in this file while a rebuilt environment has
    // nothing. `migrationReplay` proves the same thing far more precisely, by
    // building the schema and looking — but it needs a Postgres, and this runs
    // in the fast job on every push.
    const migrations = readdirSync(resolve(REPO_ROOT, "supabase/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(resolve(REPO_ROOT, "supabase/migrations", file), "utf8"))
      .join("\n");

    const untracked = [...inventory.tables.keys()]
      .filter((table) => schema.tables.has(table))
      .filter((table) => !new RegExp(`create table[^;]*\\b${table}\\b`, "is").test(migrations))
      // Views are declared, not created as tables; `leaderboard_profiles` is
      // the one the app reads.
      .filter((table) => !new RegExp(`create (or replace )?view[^;]*\\b${table}\\b`, "is").test(migrations))
      // And a table can arrive under one name and be renamed later —
      // `user_sound_progress` was `user_letter_progress` until the semantic
      // renames, so its CREATE never mentions the name the app uses.
      .filter((table) => !new RegExp(`rename to\\s+${table}\\b`, "i").test(migrations));

    expect(
      untracked.sort(),
      `These tables are in the generated types and in the app's queries, but no ` +
        `migration creates them — so they exist only in the database they were ` +
        `clicked into, and a rebuilt environment would not have them.`,
    ).toEqual([]);
  });
});

describe("columns", () => {
  /**
   * Column names that are not columns.
   *
   * PostgREST accepts a few identifiers in the same positions as columns —
   * aggregate syntax, and the `count` pseudo-column on an embed.
   */
  const NOT_COLUMNS = new Set(["count", "sum", "avg", "min", "max"]);

  it("every column the app names exists on the table it names it for", () => {
    const problems: string[] = [];

    for (const usage of inventory.tables.values()) {
      const table = getTable(usage.table);
      // Untracked tables have no generated type to check against.
      if (!table) continue;

      for (const column of usage.columns) {
        if (NOT_COLUMNS.has(column)) continue;
        if (table.columns.has(column)) continue;

        // An embed's columns are attributed to the embedded table, so a name
        // that belongs to one of them is not a problem here.
        const belongsToEmbed = [...usage.embeds].some((embed) =>
          getTable(embed)?.columns.has(column),
        );
        if (belongsToEmbed) continue;

        problems.push(
          `${usage.table}.${column} — used in ${[...usage.locations].slice(0, 2).join(", ")}`,
        );
      }
    }

    expect(
      problems,
      `These columns are queried but do not exist. PostgREST answers 400 and the ` +
        `page renders an empty state, so this is invisible at runtime.`,
    ).toEqual([]);
  });

  it("every embedded resource is a real relationship", () => {
    const problems: string[] = [];

    for (const usage of inventory.tables.values()) {
      const table = getTable(usage.table);
      if (!table) continue;

      for (const embed of usage.embeds) {
        if (!schema.tables.has(embed)) continue; // not a table name at all
        const related =
          table.relationships.some((rel) => rel.referencedRelation === embed) ||
          getTable(embed)?.relationships.some((rel) => rel.referencedRelation === usage.table);

        if (!related) {
          problems.push(`${usage.table} -> ${embed} (${[...usage.locations][0]})`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe("RPCs", () => {
  it("every rpc() the app calls is defined by a migration", () => {
    const migrations = readdirSync(resolve(REPO_ROOT, "supabase/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(resolve(REPO_ROOT, "supabase/migrations", file), "utf8"))
      .join("\n");

    const missing = [...inventory.rpcs.entries()]
      .filter(([name]) => !new RegExp(`function\\s+(public\\.)?${name}\\s*\\(`, "i").test(migrations))
      .map(([name, locations]) => `${name} (from ${[...locations].join(", ")})`);

    expect(
      missing,
      `These Postgres functions are called but no migration creates them.`,
    ).toEqual([]);
  });
});

describe("edge functions", () => {
  it("every invoked function has a directory", () => {
    const missing = [...inventory.functions.entries()]
      .filter(([name]) => !existsSync(resolve(REPO_ROOT, "supabase/functions", name, "index.ts")))
      .map(([name, locations]) => `${name} (from ${[...locations].join(", ")})`);

    expect(
      missing,
      `The app invokes these edge functions but they do not exist. This 404s at ` +
        `runtime with no type error to catch it first.`,
    ).toEqual([]);
  });

  it("records the functions that exist but nothing calls", () => {
    const deployed = readdirSync(resolve(REPO_ROOT, "supabase/functions"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name);

    const uncalled = deployed.filter((name) => !inventory.functions.has(name)).sort();

    // Not a failure — several are cron jobs, ops scripts or called by other
    // functions server-side. Pinned so the number cannot drift upward silently,
    // since an uncalled function is still deployed and still reachable.
    expect(uncalled.length).toBeLessThanOrEqual(25);
  });
});
