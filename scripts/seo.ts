/**
 * robots.txt and sitemap.xml, built rather than committed.
 *
 * They used to be two static files in `public/`, inherited from Hakiya at the
 * fork and never touched: every one of the thirty URLs in the sitemap, and the
 * `Sitemap:` line in robots.txt, pointed at `https://laha-arabic.lovable.app`.
 * Half the paths were Hakiya's routes, several of them pruned from this app
 * during the retarget. Shipping that would have handed search engines another
 * product's domain and a list of pages that do not exist here.
 *
 * Generating them fixes both halves at once. The origin comes from
 * `VITE_PUBLIC_SITE_URL`, so it is one value to set rather than thirty URLs to
 * edit, and the paths come from the route manifest, so a public page added
 * later is in the sitemap without anyone remembering.
 *
 * With no origin configured, robots.txt still ships — the `Disallow: /admin`
 * is worth having whatever the domain — and the sitemap is omitted entirely
 * rather than guessed at. A sitemap of relative URLs is invalid, and one
 * pointing at a hostname nobody chose is how this file got into trouble the
 * first time.
 */

/**
 * Path prefixes no crawler should follow.
 *
 * One list, used by both files, because they were free to contradict each
 * other before and did: `/admin/login` is `gate: "public"` in the manifest — a
 * visitor really can open it — so it was advertised in the sitemap while
 * robots.txt disallowed the very same path. A sitemap entry for a disallowed
 * URL is a crawler asking a question it has already been told not to ask.
 */
export const DISALLOWED_PREFIXES = ["/admin"];

const isDisallowed = (path: string): boolean =>
  DISALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/**
 * Public routes that exist for a visitor but do not belong in an index.
 *
 * Each of these is a step in a flow rather than a page anyone should arrive at
 * from a search result. `src/test/seo.test.ts` fails when a public route is in
 * neither this list nor the sitemap, so the decision has to be made rather than
 * defaulted.
 */
export const NOT_INDEXABLE = new Map<string, string>([
  ["/auth", "sign-in form; nothing to read, and a search hit here is a dead end"],
  ["/reset-password", "reached from an emailed link, and meaningless without its token"],
  ["/onboarding", "a step inside signup, not a destination"],
  ["/index", "a redirect to /"],
]);

/**
 * The paths worth indexing, from the route manifest.
 *
 * Only `public` routes: anything behind an auth or admin gate renders a
 * redirect to a crawler, and listing it invites indexing a login page. Routes
 * carrying a `:param` are excluded too — their concrete URLs are content ids,
 * which belong in a generated content sitemap if they ever belong anywhere,
 * not in a list of the app's pages.
 */
/** The shape this needs from a route manifest entry, and nothing more. */
export interface SitemapRoute {
  path: string;
  gate: string;
  redirectsTo?: string;
}

export function indexablePaths(routes: readonly SitemapRoute[]): string[] {
  return routes
    .filter((route) => route.gate === "public")
    .filter((route) => !route.redirectsTo)
    .filter((route) => !route.path.includes(":"))
    .filter((route) => !route.path.includes("*"))
    .map((route) => route.path)
    .filter((path) => !isDisallowed(path))
    .filter((path) => !NOT_INDEXABLE.has(path))
    .sort();
}

/** Strip any trailing slash so `${origin}${path}` never doubles it. */
const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, "");

export function buildRobots(origin: string | undefined): string {
  const lines = ["User-agent: *", "Allow: /"];

  for (const prefix of DISALLOWED_PREFIXES) {
    lines.push(`Disallow: ${prefix}`, `Disallow: ${prefix}/`);
  }

  if (origin) {
    lines.push("", `Sitemap: ${normalizeOrigin(origin)}/sitemap.xml`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Change frequency and priority per path.
 *
 * Both are hints a crawler is free to ignore, so this stays deliberately
 * coarse: the front door, then the pages that gain content as lessons and
 * videos land, then everything else.
 */
function hintsFor(path: string): { changefreq: string; priority: string } {
  if (path === "/") return { changefreq: "weekly", priority: "1.0" };
  if (["/discover", "/learn", "/curriculum", "/today"].includes(path)) {
    return { changefreq: "weekly", priority: "0.8" };
  }
  return { changefreq: "monthly", priority: "0.6" };
}

export function buildSitemap(origin: string, paths: readonly string[]): string {
  const base = normalizeOrigin(origin);
  const urls = paths.map((path) => {
    const { changefreq, priority } = hintsFor(path);
    // `/` must not become `//`, and every other path already starts with one.
    const loc = path === "/" ? `${base}/` : `${base}${path}`;
    return `  <url><loc>${loc}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
