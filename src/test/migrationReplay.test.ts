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
 * Migrations that do not replay from scratch today.
 *
 * Five try to create something an earlier migration already created; two
 * reference tables that no migration creates at all. Recorded rather than
 * fixed, because fixing the last two means writing migrations for tables whose
 * real shape only production knows — that needs a schema dump, not a guess.
 *
 * The five duplicates are the tail of a pattern that has now been cleared
 * everywhere else: the platform periodically re-emitted an already-authored
 * migration under a fresh hashed filename, so the repo carried two files
 * creating the same objects and the second one always failed. The clean
 * duplicates were deleted; these five are held back because each also carries
 * something the authored file does not (seed rows, an extra table), so working
 * out what would be lost is a per-file question rather than a sweep.
 *
 * The list is pinned so it cannot grow. Shrinking it is the goal.
 */
const KNOWN_REPLAY_FAILURES = [
  "20260310162719_f1a34d54-03ec-4147-b0c7-3e05cb33bb72.sql",
  "20260312221908_25061ea3-ebd3-4d38-88d2-93ecb71be95a.sql",
  "20260320182853_6ba0bfc1-bcfb-4e7f-a3c8-99b9489e5084.sql",
  "20260321143044_9fae3e9f-1f44-478b-895f-db560d3b03dc.sql",
  "20260321182338_c12bdf4f-7518-40cb-bf1b-f02d1c61009e.sql",
  "20260529150401_dc0b25a8-3051-4445-a8be-cd323f128c64.sql",
  "20260529155315_a303684f-1e60-4e83-8c60-8f228e46c637.sql",
];

/**
 * Tables the app reads that replaying the migrations does not produce.
 *
 * `subscribers` used to be here and is not any more: it is created by
 * 20260812103000 and by the platform snapshot beside it, both with
 * IF NOT EXISTS, so a rebuilt database now gets it. That one mattered most —
 * `_shared/usageCap.ts` reads it to decide whether a caller is paying, so
 * without it every user looked free-tier on a fresh environment.
 */
const KNOWN_MISSING_TABLES = ["processed_videos", "review_streaks"];

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
