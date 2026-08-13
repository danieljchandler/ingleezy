import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glob } from "glob";
import { PAGE_HINTS } from "./pageHints";

/**
 * The explanatory copy behind every (i) icon.
 *
 * `PAGE_HINTS` is a plain lookup, so a key that does not exist yields
 * `undefined` — and `<InfoHint {...PAGE_HINTS["typo"]} />` spreads nothing at
 * all, rendering an icon whose tooltip is blank. Nothing throws, nothing logs,
 * and the failure is only visible to someone who taps that particular icon on
 * that particular page.
 *
 * So the guard is a drift check: every key any component looks up must exist.
 * Same technique as the route manifest and the edge-function coverage test —
 * read the source of truth off disk rather than maintaining a second list.
 */

const SRC = join(process.cwd(), "src");

/** Every `PAGE_HINTS["..."]` lookup in the codebase, with the file it is in. */
async function lookups(): Promise<Array<{ key: string; file: string }>> {
  const files = await glob("**/*.{ts,tsx}", { cwd: SRC, absolute: true });
  const found: Array<{ key: string; file: string }> = [];

  for (const file of files) {
    if (file.endsWith("pageHints.ts") || file.endsWith("pageHints.test.ts")) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/PAGE_HINTS\[\s*["']([^"']+)["']\s*\]/g)) {
      found.push({ key: match[1], file: file.slice(SRC.length + 1) });
    }
  }
  return found;
}

describe("hint lookups", () => {
  it("finds the lookups it is checking", async () => {
    // A guard that silently matches nothing is worse than no guard.
    const found = await lookups();
    expect(found.length).toBeGreaterThan(5);
  });

  it("has copy for every key a component asks for", async () => {
    const missing = (await lookups())
      .filter(({ key }) => !(key in PAGE_HINTS))
      .map(({ key, file }) => `${key} (used in ${file})`);

    expect(
      missing,
      `These PAGE_HINTS keys do not exist, so the (i) icon renders with no ` +
        `tooltip and nothing warns anyone:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the copy itself", () => {
  it("gives every hint a title and a body", () => {
    const incomplete = Object.entries(PAGE_HINTS)
      .filter(([, hint]) => !hint.title?.trim() || !hint.body?.trim())
      .map(([key]) => key);

    // The title is the tooltip's heading and the body is the explanation; one
    // without the other renders as a floating fragment.
    expect(incomplete).toEqual([]);
  });

  it("keeps every title short enough to read as a heading", () => {
    const long = Object.entries(PAGE_HINTS)
      .filter(([, hint]) => hint.title.length > 40)
      .map(([key, hint]) => `${key}: ${hint.title.length} chars`);

    expect(long).toEqual([]);
  });

  it("never leaves a call to action empty", () => {
    // `cta` is optional, but an empty string renders the element with nothing
    // in it rather than omitting it.
    const empty = Object.entries(PAGE_HINTS)
      .filter(([, hint]) => hint.cta !== undefined && !hint.cta.trim())
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it("uses the app's current name throughout", () => {
    // The rename from Lahja to Hakiya touched copy as well as storage keys;
    // user-visible strings are the half nobody gets a migration for.
    const stale = Object.entries(PAGE_HINTS)
      .filter(([, hint]) => /lahja/i.test(`${hint.title} ${hint.body} ${hint.cta ?? ""}`))
      .map(([key]) => key);

    expect(stale).toEqual([]);
  });
});
