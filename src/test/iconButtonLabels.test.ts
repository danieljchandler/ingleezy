import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Icon-only buttons need an accessible name.
 *
 * `<Button size="icon">` renders a control whose only content is an SVG. With
 * no `aria-label`, `title` or visible text it has no accessible name at all:
 * a screen reader announces it as "button", and it cannot be addressed by role
 * and name — which is also why several of them were untestable until labels
 * were added.
 *
 * The admin console is the worst affected, and its buttons are the destructive
 * ones. Pinned as a baseline rather than fixed wholesale: labelling all of them
 * is a wide, mechanical change that deserves its own commit, and this makes
 * sure the number goes down rather than up in the meantime.
 */

const REPO_ROOT = resolve(__dirname, "../..");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * Count `size="icon"` buttons with nothing to announce.
 *
 * Deliberately a text scan rather than a render: the question is whether the
 * source gives the control a name, and every one of these is a literal in JSX.
 * Looks a few lines either side of the marker, since props wrap.
 */
function unlabelledIconButtons(source: string): number {
  const lines = source.split("\n");
  let count = 0;

  for (let index = 0; index < lines.length; index++) {
    if (!/size="icon"/.test(lines[index])) continue;

    // The opening tag's props, plus its children up to the close.
    const window = lines.slice(Math.max(0, index - 6), index + 8).join("\n");
    const hasName =
      /aria-label/.test(window) ||
      /title=/.test(window) ||
      /aria-labelledby/.test(window) ||
      /<span className="sr-only"/.test(window);

    if (!hasName) count++;
  }

  return count;
}

describe("icon-only buttons", () => {
  const files = tsxFiles(resolve(REPO_ROOT, "src"));

  const countsByArea = (predicate: (path: string) => boolean) =>
    files
      .filter(predicate)
      .reduce((total, file) => total + unlabelledIconButtons(readFileSync(file, "utf8")), 0);

  it("does not grow in the admin console", () => {
    const admin = countsByArea(
      (path) => path.includes("/pages/admin/") || path.includes("/components/admin/"),
    );

    // Lower this in the same commit that adds labels — it only moves down.
    expect(
      admin,
      `Unlabelled icon-only buttons in the admin console. These are the ` +
        `destructive controls, and they announce as just "button". Add ` +
        `aria-label and lower this number.`,
    ).toBeLessThanOrEqual(49);
  });

  it("does not grow across the app", () => {
    const total = countsByArea(() => true);

    expect(total).toBeLessThanOrEqual(78);
  });

  it("keeps the labels that exist", () => {
    // The two on the topics list are load-bearing: the CRUD spec addresses them
    // by name, and they are the pattern the rest should follow.
    const topics = readFileSync(resolve(REPO_ROOT, "src/pages/admin/Topics.tsx"), "utf8");
    expect(topics).toContain("aria-label={`Edit ");
    expect(topics).toContain("aria-label={`Delete ");
    expect(unlabelledIconButtons(topics)).toBe(0);
  });
});
