import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

/**
 * Consistency between the function directories and supabase/config.toml.
 *
 * `verify_jwt` is declared per function in config.toml and enforced by the
 * platform, not by any code a test can call. So the thing worth checking is
 * that the declarations and the deployed set have not drifted apart: a function
 * with no entry silently inherits the platform default (JWT required), and an
 * entry with no function is a rule guarding nothing.
 *
 * Cheap, and it audits all 84 functions at once.
 */

const CONFIG = await Deno.readTextFile(new URL("../../config.toml", import.meta.url));

/** Directory names under supabase/functions, excluding the support ones. */
async function functionDirectories(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(new URL("../", import.meta.url))) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith("_")) continue;
    names.push(entry.name);
  }
  return names.sort();
}

/** `[functions.<name>]` blocks, mapped to their declared verify_jwt. */
function declaredFunctions(): Map<string, boolean | null> {
  const declared = new Map<string, boolean | null>();
  const blocks = CONFIG.split(/^\[functions\./m).slice(1);

  for (const block of blocks) {
    const name = block.slice(0, block.indexOf("]"));
    const verify = /verify_jwt\s*=\s*(true|false)/.exec(block);
    declared.set(name, verify ? verify[1] === "true" : null);
  }

  return declared;
}

Deno.test("every config.toml entry names a function that exists", async () => {
  const directories = new Set(await functionDirectories());
  const orphans = [...declaredFunctions().keys()].filter((name) => !directories.has(name));

  assertEquals(
    orphans,
    [],
    `config.toml declares verify_jwt for functions that no longer exist: ${orphans.join(", ")}. ` +
      `Remove the blocks, or restore the functions.`,
  );
});

Deno.test("every declaration states verify_jwt explicitly", async () => {
  const declared = declaredFunctions();
  const silent = [...declared.entries()]
    .filter(([, verify]) => verify === null)
    .map(([name]) => name);

  assertEquals(
    silent,
    [],
    `These config.toml blocks exist but set no verify_jwt: ${silent.join(", ")}. ` +
      `A block that says nothing is worse than no block — it looks deliberate.`,
  );
});

Deno.test("functions handling payment or user data require a JWT", async () => {
  // The set that must never become public. Stated here rather than only in
  // config.toml so that flipping one to false fails a test rather than passing
  // review as a one-word diff.
  const mustVerify = [
    "create-checkout",
    "check-subscription",
    "customer-portal",
    "process-approved-video",
    "curriculum-chat",
    "generate-flashcard-image",
    "generate-story",
    "record-grammar-outcome",
    "draft-dialect-rules",
    "mine-dialect-corpus",
    "dialect-violations-digest",
    "extract-concepts",
    "extract-grammar-points",
    "ai-resegment-transcript",
  ];

  const declared = declaredFunctions();
  const wrong = mustVerify.filter((name) => declared.get(name) !== true);

  assertEquals(
    wrong,
    [],
    `These must keep verify_jwt = true in supabase/config.toml: ${wrong.join(", ")}.`,
  );
});

Deno.test("the undeclared functions are listed, so the default is a choice", async () => {
  // Functions absent from config.toml inherit the platform default, which is
  // "JWT required". That is the safe direction, so this does not fail — but
  // the count is pinned so a new batch of undeclared functions is noticed
  // rather than accumulating silently.
  const directories = await functionDirectories();
  const declared = declaredFunctions();
  const undeclared = directories.filter((name) => !declared.has(name));

  // Adjust deliberately, in the same commit that adds or declares a function.
  assertEquals(
    undeclared.length,
    // 36 since `sync-hakiya-videos` was declared explicitly (admin-only
    // bridge; previously 37 since `convert-to-fusha`, which is capped per
    // user and answers 401 without a JWT anyway — the inherited default is
    // the one it wants).
    36,
    `The number of functions with no config.toml entry changed (now ${undeclared.length}: ` +
      `${undeclared.join(", ")}). They inherit verify_jwt = true. If that is right, ` +
      `update this count; if not, add a block.`,
  );
});
