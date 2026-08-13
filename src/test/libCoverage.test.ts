import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glob } from "glob";

/**
 * Every module in `src/lib` must be named by some test.
 *
 * `src/lib` is where the app's decisions live — the SRS scheduler, the review
 * queue and its offline backoff, the xlsx parser, the WAV encoders, the storage
 * shims, the preference readers. Almost none of it renders, so a regression
 * here does not look like a broken page: it looks like a card scheduled for the
 * wrong day, a preference that stops sticking, or an upload that quietly gets
 * bigger. Getting all of it covered took the length of Phase 5, and losing that
 * would be silent — a new module compiles, CI stays green, and nothing calls it
 * but the app.
 *
 * The check is deliberately shallow, like the edge-function one it mirrors: a
 * module's name appearing in a test file is a claim that someone looked at it.
 * That claim is the thing that goes missing. Depth is what review is for.
 */

const LIB = join(process.cwd(), "src", "lib");

/**
 * Modules that are checked through their callers rather than directly.
 *
 * Kept explicit and short. Anything added here needs a reason that would
 * survive being read aloud in review.
 */
const COVERED_ELSEWHERE = new Map<string, string>([
  [
    "utils",
    "The six-line `cn` wrapper around clsx and tailwind-merge. Testing it would " +
      "be testing those two libraries.",
  ],
]);

async function libModules(): Promise<string[]> {
  const files = await glob("**/*.{ts,tsx}", { cwd: LIB });
  return files
    .filter((file) => !file.includes(".test."))
    .map((file) => file.replace(/\.(ts|tsx)$/, ""))
    .sort();
}

/** Every test file's text in one string — module names are looked up as substrings. */
async function testCorpus(): Promise<string> {
  const files = await glob("src/**/*.test.{ts,tsx}", { cwd: process.cwd(), absolute: true });
  return files
    .filter((file) => !file.endsWith("libCoverage.test.ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

describe("lib coverage", () => {
  it("has a test naming every module", async () => {
    const corpus = await testCorpus();
    const uncovered = (await libModules())
      .filter((module) => !COVERED_ELSEWHERE.has(module))
      // The basename, because a nested module is imported by path.
      .filter((module) => !corpus.includes(module.split("/").pop()!));

    expect(
      uncovered,
      `These src/lib modules are named by no test. Add one next to the module ` +
        `as <name>.test.ts, or add it to COVERED_ELSEWHERE with a reason:\n  ` +
        uncovered.join("\n  "),
    ).toEqual([]);
  });

  it("keeps the exemption list honest", async () => {
    const modules = new Set(await libModules());
    const stale = [...COVERED_ELSEWHERE.keys()].filter((name) => !modules.has(name));

    // An exemption for a module that no longer exists is an exemption nobody
    // will re-examine when a module of that name comes back.
    expect(stale, `These exemptions name modules that no longer exist: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("finds the modules it claims to be checking", async () => {
    // A guard that silently matches nothing passes forever.
    const modules = await libModules();
    expect(modules.length).toBeGreaterThan(40);
    expect(modules).toContain("spacedRepetition");
  });
});
