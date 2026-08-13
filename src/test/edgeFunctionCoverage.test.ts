import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every edge function must have runtime tests.
 *
 * Getting all 84 covered took the whole of Phase 6, and the failure mode this
 * guards against is quiet: a new function lands, `deno check` proves it
 * compiles, CI stays green, and nothing ever calls it until a user does. There
 * is no signal — an uncovered function looks exactly like a covered one from
 * the outside.
 *
 * The check is deliberately shallow. It asserts a function's name appears in
 * `supabase/functions/_test/`, not that the tests are any good; a name in a
 * test file is a claim that someone looked at it, which is the thing that goes
 * missing. Depth is what review is for.
 *
 * Same technique as `grammarTaxonomy.test.ts` (parses a migration) and
 * `routeManifest.test.ts` (parses App.tsx): read the source of truth off disk
 * and fail on drift, rather than maintaining a list by hand.
 */

const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");
const TEST_DIR = join(FUNCTIONS_DIR, "_test");

/** Every deployable function — the underscore-prefixed dirs are shared code. */
function functionNames(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

/** Every test file's text, concatenated — the names are looked up as substrings. */
function testCorpus(): string {
  return readdirSync(TEST_DIR)
    .filter((name) => name.endsWith("_test.ts"))
    .map((name) => readFileSync(join(TEST_DIR, name), "utf8"))
    .join("\n");
}

describe("edge function coverage", () => {
  it("has runtime tests naming every function", () => {
    const corpus = testCorpus();
    // Quoted, so `story-video` does not count as covering `story-video-full`
    // and vice versa. Every harness entry point takes the name as a string
    // literal, so the quotes are always there to match.
    const uncovered = functionNames().filter((name) => !corpus.includes(`"${name}"`));

    expect(
      uncovered,
      `These edge functions have no runtime tests. Add a spec in ` +
        `supabase/functions/_test/ that loads each one with ` +
        `loadFunction("<name>"):\n  ${uncovered.join("\n  ")}`,
    ).toEqual([]);
  });

  it("finds the functions it claims to be checking", () => {
    // A guard that silently checks nothing is worse than no guard. If the
    // directory layout moves, this fails rather than passing vacuously.
    const names = functionNames();
    expect(names.length).toBeGreaterThan(80);
    expect(names).toContain("process-approved-video");
  });
});
