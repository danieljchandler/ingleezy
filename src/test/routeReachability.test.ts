import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./support/routes/manifest";

/**
 * Every learner route has a way in that does not involve typing a URL.
 *
 * This exists because of a bug nothing else could have caught. Replacing three
 * hub screens with the dock deleted the only links to six working features —
 * the daily dashboard, the conversation simulator, grammar drills, the daily
 * challenge, your mistakes and native feedback. All six kept their routes,
 * their pages, their hooks and their tests. Every one of those tests kept
 * passing, because a test navigates by URL and never asks how a person would
 * have got there.
 *
 * So the failure mode is a feature that still works perfectly and that nobody
 * can reach. It costs nothing to run and is invisible in review, which is
 * exactly the profile of a check worth automating.
 *
 * The allow-list below is the interesting part: a route on it is a claim that
 * this route is *meant* to be reached some other way, and the reason has to be
 * written down.
 */

/** Routes deliberately without an in-app link, and why. */
const NO_LINK_NEEDED: Record<string, string> = {
  "/": "the front door — nothing links to it because everything starts there",
  "/index": "a redirect kept for old bookmarks",
  "/learn-hub": "a redirect kept for old bookmarks",
  "/practice": "a redirect kept for old bookmarks",
  "/auth": "reached by the guard on every protected route, not by a link",
  "/onboarding": "entered once, straight after sign-up",
  "/reset-password": "arrived at from a link in an email",
  "/quiz/:lessonId": "opened from inside a lesson, which builds the path from data",
  "/today/story": "opened from the daily dashboard, which builds the path from data",
};

// Resolved from the working directory rather than import.meta.url: under the
// jsdom environment this file is served to the test as an http URL, so
// fileURLToPath on it throws. Vitest always runs from the repo root.
const SRC = resolve(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

/** Every internal path the app links to or navigates to, from anywhere. */
function linkedPaths(): Set<string> {
  const found = new Set<string>();
  const patterns = [
    /\bto="(\/[^"]*)"/g,
    /\bto:\s*"(\/[^"]*)"/g,
    /navigate\("(\/[^"]*)"/g,
    /navigate\(`(\/[^`$]*)/g,
    /\bhref="(\/[^"]*)"/g,
    /\bto=\{`(\/[^`$]*)/g,
  ];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const [, path] of text.matchAll(pattern)) found.add(path);
    }
  }
  return found;
}

/** "/stories/:id" is reachable if anything links to "/stories/..." at all. */
function isReachable(routePath: string, linked: Set<string>): boolean {
  const base = routePath.replace(/\/:[^/]+/g, "");
  if (linked.has(routePath) || linked.has(base)) return true;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return [...linked].some((l) => l.startsWith(prefix));
}

describe("route reachability", () => {
  const learnerRoutes = ROUTES.filter(
    (r) =>
      r.gate !== "admin" &&
      r.gate !== "admin-or-reviewer" &&
      !r.path.startsWith("/admin") &&
      // The catch-all is not an address; it is what happens to the addresses
      // that do not exist.
      r.path !== "*",
  );

  it("gives every learner route a way in from the app itself", () => {
    const linked = linkedPaths();
    const orphaned = learnerRoutes
      .map((r) => r.path)
      .filter((path) => !(path in NO_LINK_NEEDED) && !isReachable(path, linked));

    expect(
      orphaned,
      `No link anywhere in src/ reaches ${orphaned.join(", ")}. Either link it from a ` +
        `surface a learner can find, or add it to NO_LINK_NEEDED with the reason it is ` +
        `reached another way.`,
    ).toEqual([]);
  });

  it("keeps the allow-list from outliving the routes it excuses", () => {
    // An entry left behind after its route is deleted quietly excuses a path
    // that no longer exists, and the next route to take that path inherits the
    // excuse without anyone deciding to give it one.
    const paths = new Set(ROUTES.map((r) => r.path));
    const stale = Object.keys(NO_LINK_NEEDED).filter((p) => !paths.has(p));

    expect(stale, `NO_LINK_NEEDED names routes that no longer exist: ${stale.join(", ")}`)
      .toEqual([]);
  });
});
