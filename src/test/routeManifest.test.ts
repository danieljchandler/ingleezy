import { describe, expect, it } from "vitest";
import { parseAppRoutes } from "./support/routes/parseAppRoutes";
import { byPath, concreteUrl, ROUTES } from "./support/routes/manifest";

/**
 * Keeps the route manifest honest against `src/App.tsx`.
 *
 * Without this, the sweep in `e2e/routes.spec.ts` would cover whatever someone
 * remembered to add, and a new route would ship untested and unnoticed. Here,
 * adding a `<Route>` and no manifest entry turns the fast unit job red with a
 * message saying what to do.
 *
 * Same technique as `src/test/grammarTaxonomy.test.ts`, which parses a
 * migration and fails when the SQL and the TypeScript drift apart.
 */

const declared = parseAppRoutes();

// <Route path="/admin"> also carries an <Route index> child that resolves to
// the same path; they are one address as far as a test is concerned.
const declaredPaths = [...new Set(declared.map((route) => route.path))];

describe("route manifest", () => {
  it("covers every route declared in App.tsx", () => {
    const missing = declaredPaths.filter((path) => !byPath.has(path));

    expect(
      missing,
      `These routes exist in src/App.tsx but have no entry in ` +
        `src/test/support/routes/manifest.ts, so nothing tests them. Add an ` +
        `entry (with its gate) and they will be picked up by e2e/routes.spec.ts.`,
    ).toEqual([]);
  });

  it("has no entries for routes that no longer exist", () => {
    const stale = ROUTES.map((route) => route.path).filter(
      (path) => !declaredPaths.includes(path),
    );

    expect(
      stale,
      `These paths are in the manifest but no longer declared in src/App.tsx. ` +
        `Remove them, or restore the route.`,
    ).toEqual([]);
  });

  it("agrees with App.tsx about which routes are behind ProtectedRoute", () => {
    // The manifest's gate drives what the sweep expects a signed-out visitor to
    // see. If the two disagree, the sweep asserts the wrong thing.
    const disagreements = declared
      .filter((route) => byPath.has(route.path))
      .filter((route) => {
        const spec = byPath.get(route.path);
        if (!spec) return false;
        const manifestSaysAuth = spec.gate === "auth";
        return manifestSaysAuth !== route.protected;
      })
      .map((route) => `${route.path}: App.tsx protected=${route.protected}`);

    expect(disagreements).toEqual([]);
  });

  it("records the ErrorBoundary name each route is wrapped in", () => {
    const mismatched = declared
      .filter((route) => route.boundary !== undefined && byPath.has(route.path))
      .filter((route) => byPath.get(route.path)?.boundary !== route.boundary)
      .map((route) => `${route.path}: App.tsx says ${route.boundary}`);

    expect(mismatched).toEqual([]);
  });

  it("gives every ErrorBoundary a unique name", () => {
    // The name is the key logged to client_errors, so a duplicate makes two
    // different crashes indistinguishable in the admin error view.
    const names = declared.map((route) => route.boundary).filter(Boolean) as string[];
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

    expect([...new Set(duplicates)]).toEqual([]);
  });

  it("records where each redirect-only route points", () => {
    for (const route of declared.filter((candidate) => candidate.redirectsTo)) {
      expect(byPath.get(route.path)?.redirectsTo).toBe(route.redirectsTo);
    }
  });

  it("can build a concrete URL for every route", () => {
    // A `:param` with no sample value would fail deep inside the e2e sweep,
    // where the message is far less obvious.
    for (const route of ROUTES) {
      expect(() => concreteUrl(route)).not.toThrow();
      expect(concreteUrl(route)).not.toContain(":");
    }
  });

  it("keeps skipped routes rare and explained", () => {
    const skipped = ROUTES.filter((route) => route.skipRender);
    for (const route of skipped) {
      expect(route.skipRender, `${route.path} is skipped without a reason`).toBeTruthy();
    }
    // A route nobody loads is a route nobody knows is broken.
    expect(skipped.length).toBeLessThan(5);
  });

  it("puts the content-reviewer allow-list in the manifest, not just in rbac.ts", () => {
    // src/lib/rbac.ts allows /admin plus these three prefixes. The manifest has
    // to agree or the sweep will assert the wrong redirect for a reviewer.
    const reviewerRoutes = ROUTES.filter((route) => route.gate === "admin-or-reviewer");
    const prefixes = ["/admin", "/admin/videos", "/admin/set-phrases", "/admin/dialect-rules"];

    for (const route of reviewerRoutes) {
      expect(
        prefixes.some((prefix) => route.path === prefix || route.path.startsWith(`${prefix}/`)),
        `${route.path} is marked admin-or-reviewer but is not on rbac.ts's allow-list`,
      ).toBe(true);
    }
  });
});
