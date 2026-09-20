import { describe, expect, it } from "vitest";
import {
  buildRobots,
  buildSitemap,
  DISALLOWED_PREFIXES,
  indexablePaths,
  NOT_INDEXABLE,
} from "../../scripts/seo";
import { ROUTES } from "./support/routes/manifest";

/**
 * The two files a crawler reads first.
 *
 * Both were committed under `public/` and both still carried Hakiya's domain
 * eight months after the fork — `https://laha-arabic.lovable.app` on the
 * `Sitemap:` line and on all thirty URLs, several of them routes this app
 * pruned during the retarget. Nothing tested them because nothing imported
 * them; they were inert text that only a search engine would ever read, which
 * is exactly why nobody noticed.
 *
 * They are generated now, and this is what stops them rotting again: a public
 * route that nobody has classified fails here, by name.
 */

const ORIGIN = "https://ingleezy.example";

describe("robots.txt", () => {
  it("keeps crawlers out of the admin surface", () => {
    expect(buildRobots(ORIGIN)).toContain("Disallow: /admin");
  });

  it("points at the sitemap when there is an origin", () => {
    expect(buildRobots(ORIGIN)).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it("still ships without one, minus the sitemap line", () => {
    // The Disallow is worth having whatever the domain turns out to be. A
    // `Sitemap:` line pointing at a hostname nobody chose is how the old file
    // ended up advertising another product's site.
    const robots = buildRobots(undefined);
    expect(robots).toContain("Disallow: /admin");
    expect(robots).not.toContain("Sitemap:");
  });

  it("does not double the slash on an origin that has one", () => {
    expect(buildRobots("https://ingleezy.example/")).toContain(
      "Sitemap: https://ingleezy.example/sitemap.xml",
    );
  });
});

describe("sitemap.xml", () => {
  const sitemap = buildSitemap(ORIGIN, indexablePaths(ROUTES));

  it("is well-formed and absolute", () => {
    expect(sitemap).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(sitemap.trimEnd()).toMatch(/<\/urlset>$/);
    for (const loc of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      expect(loc[1].startsWith(`${ORIGIN}/`)).toBe(true);
    }
  });

  it("renders the front door as the origin with a single slash", () => {
    expect(sitemap).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(sitemap).not.toContain(`<loc>${ORIGIN}//`);
  });

  it("carries no trace of the domain it was forked from", () => {
    // The specific string, because this is the actual regression.
    expect(sitemap).not.toContain("laha-arabic");
    expect(sitemap).not.toContain("lovable.app");
  });

  it("lists no route behind a gate", () => {
    const gated = new Set(
      ROUTES.filter((route) => route.gate !== "public").map((route) => route.path),
    );
    for (const path of indexablePaths(ROUTES)) {
      expect(gated.has(path), `${path} is gated and must not be advertised`).toBe(false);
    }
  });

  it("advertises nothing robots.txt disallows", () => {
    // These two contradicted each other on the first cut of this generator:
    // `/admin/login` is a public route, so it was listed, while robots.txt was
    // telling crawlers to stay out of `/admin` in the same breath.
    for (const path of indexablePaths(ROUTES)) {
      for (const prefix of DISALLOWED_PREFIXES) {
        expect(
          path === prefix || path.startsWith(`${prefix}/`),
          `${path} is disallowed in robots.txt and must not be in the sitemap`,
        ).toBe(false);
      }
    }
  });

  it("lists no parameterised route", () => {
    // `/learn/:lessonId` has no single URL, and its concrete ones are content
    // ids rather than pages of the app.
    for (const path of indexablePaths(ROUTES)) {
      expect(path).not.toContain(":");
    }
  });

  it("lists no redirect", () => {
    const redirects = new Set(
      ROUTES.filter((route) => route.redirectsTo).map((route) => route.path),
    );
    for (const path of indexablePaths(ROUTES)) {
      expect(redirects.has(path), `${path} only redirects`).toBe(false);
    }
  });
});

describe("classifying a new public page", () => {
  it("has a decision recorded for every public route", () => {
    // The drift guard. Add a public page and it is in the sitemap; decide it
    // should not be and it goes in NOT_INDEXABLE with a reason. What cannot
    // happen is a page that is in neither, which is how a sitemap quietly stops
    // describing the app.
    const indexable = new Set(indexablePaths(ROUTES));

    const unclassified = ROUTES.filter(
      (route) =>
        route.gate === "public" &&
        !route.redirectsTo &&
        !route.path.includes(":") &&
        !route.path.includes("*") &&
        !DISALLOWED_PREFIXES.some(
          (prefix) => route.path === prefix || route.path.startsWith(`${prefix}/`),
        ) &&
        !indexable.has(route.path) &&
        !NOT_INDEXABLE.has(route.path),
    ).map((route) => route.path);

    expect(
      unclassified,
      `These public routes are in neither the sitemap nor NOT_INDEXABLE ` +
        `(scripts/seo.ts). Add each one to NOT_INDEXABLE with a reason, or let ` +
        `it be indexed.`,
    ).toEqual([]);
  });

  it("keeps no exclusion for a route that no longer exists", () => {
    // The other half, borrowed from routeReachability: a stale exemption is
    // worse than none, because the next route to take that path inherits it.
    const paths = new Set(ROUTES.map((route) => route.path));
    const orphaned = [...NOT_INDEXABLE.keys()].filter((path) => !paths.has(path));

    expect(
      orphaned,
      `NOT_INDEXABLE names routes that are not in the manifest any more.`,
    ).toEqual([]);
  });
});
