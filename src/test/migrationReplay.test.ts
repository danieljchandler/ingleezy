import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { extractQueries } from "./support/contract/extractQueries";

/**
 * Can the database be rebuilt from the migrations in this repo?
 *
 * The in-memory backend and the static schema check both take the *current*
 * schema as given. Neither can tell you whether the history that produced it
 * still replays — and a migration set that only works against the one database
 * it grew on is a disaster-recovery problem, a new-environment problem and a
 * local-development problem, all of which stay invisible until someone tries.
 *
 * Needs a PostgreSQL server. Skipped with a clear message when DATABASE_URL is
 * unset, so a normal `npm test` is unaffected; CI runs it against a service
 * container, where it is mandatory.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const REPO_ROOT = resolve(__dirname, "../..");

interface BuildResult {
  total: number;
  failures: Array<{ file: string; error: string }>;
  tables: string[];
  columns: Record<string, string[]>;
}

/**
 * There is no allowance list any more, and that is the point.
 *
 * There used to be two: migrations that were permitted to fail, and tables a
 * rebuilt database was permitted to be missing. Both are now empty, so the
 * assertions below are flat — every migration replays, and every table and
 * column the app names is there afterwards.
 *
 * How the last of it went, because the shape of the bug is worth keeping:
 *
 * - Fourteen failures were the platform re-emitting an already-authored
 *   migration under a fresh hashed filename. Two files created the same
 *   objects and whichever ran second always failed. Byte-equivalent
 *   re-emissions were deleted; three were *later* snapshots carrying schema
 *   the authored original predates, so that schema was recovered explicitly in
 *   20260816090000_recover_stranded_schema.sql before the duplicates went.
 *
 * - The last two referenced `processed_videos` and `review_streaks`, tables
 *   the platform dashboard created and no migration ever did. They are now
 *   authored in 20260529150400_recover_untracked_schema.sql, dated to land
 *   just before the migrations that need them.
 *
 * - Which immediately exposed a third: with those two no longer aborting
 *   20260529150401 at section 8, section 9 could run for the first time and
 *   failed on `lessons.status`, a column that did not exist until three months
 *   later in the recovery migration. Hoisted into the same new file.
 *
 * That last one is why this test now checks columns as well as tables. It used
 * to record missing TABLES, while `schemaContract` reads the app's queries
 * against the committed types file — which describes the database as it *is*,
 * not as the migrations rebuild it. A missing COLUMN fell between the two, and
 * `lessons.dialect_module` and `lessons.status` both landed in that gap.
 */
const inventory = extractQueries();

/**
 * Identifiers PostgREST accepts where a column goes but which are not columns —
 * aggregate syntax and the `count` pseudo-column on an embed. Same list as
 * `schemaContract`, for the same reason.
 */
const NOT_COLUMNS = new Set(["count", "sum", "avg", "min", "max"]);

/**
 * The one relation a correct replay is allowed not to have.
 *
 * 20260812160000 creates `content_embeddings` inside a guard on the pgvector
 * extension, which a stock Postgres does not carry. Absent here means the guard
 * worked; it is not the same thing as schema that was never migrated.
 */
const EXTENSION_GUARDED = new Set(["content_embeddings"]);

describe.skipIf(!DATABASE_URL)("migration replay", () => {
  let result: BuildResult;

  beforeAll(() => {
    const output = execFileSync("node", [resolve(REPO_ROOT, "contract/build.mjs")], {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    });
    result = JSON.parse(output) as BuildResult;
  }, 300_000);

  it("applies the prelude and reaches every migration", () => {
    expect(result.total).toBeGreaterThan(130);
  });

  it("builds the schema the app expects", () => {
    // The bulk of the work does replay: this is a floor on how much of the
    // schema a rebuilt database actually gets.
    expect(result.tables.length).toBeGreaterThan(90);
    expect(result.tables).toContain("profiles");
    expect(result.tables).toContain("user_vocabulary");
    expect(result.tables).toContain("word_reviews");
  });

  it("replays every migration without a failure", () => {
    expect(
      result.failures,
      `Migrations that do not replay from scratch:\n` +
        result.failures.map((failure) => `  ${failure.file}: ${failure.error}`).join("\n") +
        `\n\nThere is no allowance list. A migration that only applies to the ` +
        `database it grew on is the bug, not the pin.`,
    ).toEqual([]);
  });

  it("creates every table the app queries", () => {
    // Keyed off the column map rather than `result.tables`, because that comes
    // from pg_tables and the app queries views too — `leaderboard_profiles` is
    // one, and it reads like any other table from the client.
    const present = new Set(Object.keys(result.columns));
    const missing = [...inventory.tables.values()]
      .filter((usage) => !present.has(usage.table) && !EXTENSION_GUARDED.has(usage.table))
      .map((usage) => `${usage.table} (from ${[...usage.locations].slice(0, 2).join(", ")})`);

    expect(
      missing,
      `The app queries these tables and a rebuilt database would not have them.`,
    ).toEqual([]);
  });

  it("creates every column the app names", () => {
    // The check the table list could not make. `lessons.status` was absent from
    // a rebuilt database for three months without anything noticing, because
    // the table it belongs to was there all along.
    const problems: string[] = [];

    for (const usage of inventory.tables.values()) {
      const columns = result.columns[usage.table];
      if (!columns) continue; // absent tables are the previous test's business
      const has = new Set(columns);

      for (const column of usage.columns) {
        if (NOT_COLUMNS.has(column) || has.has(column)) continue;

        // An embed's columns are attributed to the embedded table, so a name
        // that belongs to one of them is not a problem here.
        const belongsToEmbed = [...usage.embeds].some((embed) =>
          result.columns[embed]?.includes(column),
        );
        if (belongsToEmbed) continue;

        problems.push(
          `${usage.table}.${column} — used in ${[...usage.locations].slice(0, 2).join(", ")}`,
        );
      }
    }

    expect(
      problems,
      `These columns are queried but replaying the migrations does not produce ` +
        `them. PostgREST answers 400 and the page renders an empty state, so on ` +
        `a rebuilt environment this is invisible until a learner reports it.`,
    ).toEqual([]);
  });
});

describe.skipIf(DATABASE_URL)("migration replay (skipped)", () => {
  it("explains why it did not run", () => {
    // A silent skip reads as a pass. This makes the reason visible in the
    // output of a normal `npm test`.
    expect(DATABASE_URL).toBeUndefined();
  });
});
