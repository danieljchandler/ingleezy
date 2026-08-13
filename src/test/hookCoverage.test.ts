import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glob } from "glob";

/**
 * Every hook in `src/hooks` must be named by some test.
 *
 * The hooks are where this app's decisions live. Almost none of them render
 * anything: they decide what is due for review, which clip a learner is shown,
 * whether a streak is at risk, what a drafted lesson is published as, and
 * whether the microphone was released when a voice session ended. A regression
 * in one does not look like a broken page — it looks like a card scheduled for
 * the wrong day, a chart that stopped moving, or a recording indicator that
 * stays lit.
 *
 * Getting all 77 covered was most of Phase 5, and losing that would be silent:
 * a new hook compiles, CI stays green, and nothing exercises it but the app.
 *
 * The check is deliberately shallow, like the `src/lib` and shared-module
 * guards it mirrors. A hook's name appearing in a test file is a claim that
 * somebody looked at it, and that claim is the thing that goes missing. Depth
 * is what review is for.
 */

const HOOKS = join(process.cwd(), "src", "hooks");

/**
 * Hooks checked through their callers rather than directly.
 *
 * Kept explicit and short. Anything added here needs a reason that would
 * survive being read aloud in review.
 */
const COVERED_ELSEWHERE = new Map<string, string>();

async function hookModules(): Promise<string[]> {
  const files = await glob("**/*.{ts,tsx}", { cwd: HOOKS });
  return files
    .filter((file) => !file.includes(".test."))
    .map((file) => file.replace(/\.(ts|tsx)$/, ""))
    .sort();
}

/** Every test file's text in one string — hook names are looked up as substrings. */
async function testCorpus(): Promise<string> {
  const files = [
    ...(await glob("src/**/*.test.{ts,tsx}", { cwd: process.cwd(), absolute: true })),
    ...(await glob("e2e/**/*.spec.ts", { cwd: process.cwd(), absolute: true })),
  ];
  return files
    .filter((file) => !file.endsWith("hookCoverage.test.ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

describe("hook coverage", () => {
  it("has a test naming every hook", async () => {
    const corpus = await testCorpus();
    const uncovered = (await hookModules())
      .filter((module) => !COVERED_ELSEWHERE.has(module))
      // Anchored on the right, so `useReviewSession` cannot vouch for
      // `useReview` — a prefix is a different hook, not the same one.
      .filter((module) => !new RegExp(`${module.split("/").pop()}(?![A-Za-z0-9])`).test(corpus));

    expect(
      uncovered,
      `These hooks are named by no test. Add one next to the hook as ` +
        `<name>.test.ts, or add it to COVERED_ELSEWHERE with a reason:\n  ` +
        uncovered.join("\n  "),
    ).toEqual([]);
  });

  it("keeps the exemption list honest", async () => {
    const modules = new Set(await hookModules());
    const stale = [...COVERED_ELSEWHERE.keys()].filter((name) => !modules.has(name));

    // An exemption for a hook that no longer exists is an exemption nobody will
    // re-examine when a hook of that name comes back.
    expect(stale, `These exemptions name hooks that no longer exist: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("finds the hooks it claims to be checking", async () => {
    // A guard that silently matches nothing passes forever.
    const modules = await hookModules();
    expect(modules.length).toBeGreaterThan(70);
    expect(modules).toContain("useAuth");
  });
});
