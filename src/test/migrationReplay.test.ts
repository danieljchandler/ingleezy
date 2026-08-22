import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

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
}

/**
 * Migrations that do not replay from scratch today: none.
 *
 * The last two were the hard two — both referenced tables no migration
 * created (`review_streaks`, `processed_videos`), whose shapes existed only
 * in production. The generated types file records production's columns, so
 * the "needs a schema dump, not a guess" objection dissolved once someone
 * read it: 20260529145900 and 20260529150000 create both tables from that
 * shape (back-dated to sort before their readers, in the same
 * no-real-project-linked window the semantic renames used), and
 * 20260529150300 back-fills `lessons.status`, which the May RLS policy
 * referenced three months before the recovery migration added it.
 *
 * The gap that hid all this is worth remembering: this test records missing
 * TABLES, while `schemaContract` reads the app's queries against the
 * committed types file — which describes the database as it is, not as the
 * migrations rebuild it. A missing COLUMN falls between the two.
 *
 * The list is pinned so it cannot grow. It is finally empty; keep it that way.
 */
const KNOWN_REPLAY_FAILURES: string[] = [];

/**
 * Tables the app reads that replaying the migrations does not produce: none.
 *
 * `subscribers` came off this list when 20260812103000 gave it a migration;
 * `review_streaks` and `processed_videos` came off with the two back-dated
 * creations above. An entry reappearing here means someone shipped a feature
 * against a table only production has — the exact debt this file exists to
 * stop.
 */
const KNOWN_MISSING_TABLES: string[] = [];

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
    expect(result.tables.length).toBeGreaterThan(70);
    expect(result.tables).toContain("profiles");
    expect(result.tables).toContain("user_vocabulary");
    expect(result.tables).toContain("word_reviews");
  });

  it("has no replay failures beyond the known ones", () => {
    const unexpected = result.failures
      .map((failure) => failure.file)
      .filter((file) => !KNOWN_REPLAY_FAILURES.includes(file));

    expect(
      unexpected,
      `New migrations fail to replay from scratch:\n` +
        result.failures
          .filter((failure) => unexpected.includes(failure.file))
          .map((failure) => `  ${failure.file}: ${failure.error}`)
          .join("\n"),
    ).toEqual([]);
  });

  it("records which known failures have since been fixed", () => {
    // Fails when the list shrinks, so the pin gets tightened rather than
    // hiding progress.
    const stillFailing = result.failures.map((failure) => failure.file);
    const fixed = KNOWN_REPLAY_FAILURES.filter((file) => !stillFailing.includes(file));

    expect(
      fixed,
      `These migrations replay cleanly now. Remove them from ` +
        `KNOWN_REPLAY_FAILURES so the list keeps meaning something.`,
    ).toEqual([]);
  });

  it("records the tables a rebuilt database would be missing", () => {
    const missing = KNOWN_MISSING_TABLES.filter((table) => !result.tables.includes(table));

    // Equality, not containment: a pinned table that starts appearing fails
    // here too, so the list has to be trimmed rather than left overstating the
    // damage. That is how `subscribers` came off it.
    expect(missing.sort()).toEqual([...KNOWN_MISSING_TABLES].sort());
  });
});

describe.skipIf(DATABASE_URL)("migration replay (skipped)", () => {
  it("explains why it did not run", () => {
    // A silent skip reads as a pass. This makes the reason visible in the
    // output of a normal `npm test`.
    expect(DATABASE_URL).toBeUndefined();
  });
});
