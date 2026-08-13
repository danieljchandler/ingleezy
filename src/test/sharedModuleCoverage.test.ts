import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glob } from "glob";

/**
 * Every module in `supabase/functions/_shared` must be named by some test.
 *
 * The shared modules are the parts of the backend that 84 functions agree on:
 * the CORS allow-list, the daily cap, the model registry, the AI brain, the
 * learner model, the dialect gate, and four sinks that write what happened.
 * A regression in any one of them is a regression in every function at once,
 * and most of them are silent by design — the loggers swallow their own errors
 * so they can never fail the request they are attached to, which also means
 * they can stop working without anything going red.
 *
 * The check is deliberately shallow, like the `src/lib` and edge-function
 * guards it mirrors: a module's name appearing in a test file is a claim that
 * someone looked at it. That claim is the thing that goes missing when a module
 * is added in a hurry. Depth is what review is for.
 *
 * Both suites count, because the split is real: pure modules are tested from
 * Vitest by relative import, and anything reading `Deno.env` or importing from
 * esm.sh is tested from `deno test`.
 */

const SHARED = join(process.cwd(), "supabase", "functions", "_shared");

/**
 * Modules that no test can name, with the reason.
 *
 * Kept explicit and short. Anything added here needs a reason that would
 * survive being read aloud in review.
 */
const COVERED_ELSEWHERE = new Map<string, string>([
  [
    "dialectTypes",
    "A single exported type alias and nothing else. There is no runtime to " +
      "test; the compiler is the whole check, and `npm run check:edge` runs it.",
  ],
]);

async function sharedModules(): Promise<string[]> {
  const files = await glob("*.ts", { cwd: SHARED });
  return files
    .filter((file) => !file.endsWith("_test.ts"))
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();
}

/** Every test file's text in one string — module names are looked up as substrings. */
async function testCorpus(): Promise<string> {
  const files = [
    ...(await glob("src/**/*.test.{ts,tsx}", { cwd: process.cwd(), absolute: true })),
    ...(await glob("supabase/functions/_test/*_test.ts", { cwd: process.cwd(), absolute: true })),
  ];
  return files
    .filter((file) => !file.endsWith("sharedModuleCoverage.test.ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

describe("shared edge module coverage", () => {
  it("has a test naming every module", async () => {
    const corpus = await testCorpus();
    const uncovered = (await sharedModules())
      .filter((module) => !COVERED_ELSEWHERE.has(module))
      // Anchored on the right, or `conceptMasteryCore` would vouch for
      // `conceptMastery` — and those two are the pure half and the IO half of
      // the same feature, which is precisely the pair worth telling apart.
      .filter((module) => !new RegExp(`${module}(?![A-Za-z0-9])`).test(corpus));

    expect(
      uncovered,
      `These supabase/functions/_shared modules are named by no test. Add one — ` +
        `Vitest for a pure module, supabase/functions/_test for anything reading ` +
        `Deno.env — or add it to COVERED_ELSEWHERE with a reason:\n  ` +
        uncovered.join("\n  "),
    ).toEqual([]);
  });

  it("keeps the exemption list honest", async () => {
    const modules = new Set(await sharedModules());
    const stale = [...COVERED_ELSEWHERE.keys()].filter((name) => !modules.has(name));

    // An exemption for a module that no longer exists is an exemption nobody
    // will re-examine when a module of that name comes back.
    expect(stale, `These exemptions name modules that no longer exist: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("finds the modules it claims to be checking", async () => {
    // A guard that silently matches nothing passes forever.
    const modules = await sharedModules();
    expect(modules.length).toBeGreaterThan(25);
    expect(modules).toContain("usageCap");
    expect(modules).toContain("aiBrain");
  });
});
