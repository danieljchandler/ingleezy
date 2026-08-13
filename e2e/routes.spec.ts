import { expect, test, type Page } from "./support/fixtures";
import { concreteUrl, ROUTES, type RouteSpec } from "../src/test/support/routes/manifest";
import type { Persona } from "../src/test/support/personas";

/**
 * Loads every route in the app.
 *
 * Before this, ~8 of 105 routes had ever been opened by a test. The rest could
 * be crashing on mount and CI would stay green. The assertions here are
 * deliberately shallow — did it render, did the right people get in — because
 * the value is in the breadth: one manifest entry buys coverage of a route that
 * previously had none, and `src/test/routeManifest.test.ts` makes adding the
 * entry non-optional.
 *
 * Depth for the flows that matter lives in the per-area specs.
 */

/** Text the app shows when something has gone wrong. None should ever appear. */
const FAILURE_SIGNALS = [
  // ErrorBoundary's fallback.
  /Something went wrong/i,
  // The global window.error / unhandledrejection handlers in App.tsx. These
  // make the sweep a crash detector for free: any unhandled rejection anywhere
  // on the page raises one of these toasts.
  /A page error occurred/i,
  /The app crashed recently/i,
  /An unexpected error occurred/i,
];

const NOT_FOUND = /We couldn't find that page/i;

/**
 * Wait for the lazily-loaded chunk to mount.
 *
 * Asserting on the skeleton's disappearance rather than a fixed timeout is what
 * keeps this stable: `page.goto` resolves as soon as the HTML lands, which is
 * well before React has the route's chunk.
 */
async function waitForPage(page: Page): Promise<void> {
  const skeleton = page.getByTestId("page-skeleton");
  await expect(skeleton).toHaveCount(0, { timeout: 15_000 });
}

/** Assert the page rendered something real rather than an error state. */
async function expectRendered(page: Page, route: RouteSpec): Promise<void> {
  await waitForPage(page);

  for (const signal of FAILURE_SIGNALS) {
    await expect(
      page.getByText(signal),
      `${route.path} rendered an error state`,
    ).toHaveCount(0);
  }

  if (route.path !== "*") {
    await expect(page.getByText(NOT_FOUND), `${route.path} rendered the 404 page`).toHaveCount(0);
  }

  // Something was actually painted — not a blank body.
  await expect(page.locator("body")).not.toBeEmpty();
}

/**
 * Apply whatever the manifest says this route legitimately does.
 *
 * Declaring it per route rather than globally keeps the guards sharp: only
 * `/conversation` gets to call OpenAI and log a realtime error, so if any other
 * page starts doing either, the sweep still catches it.
 */
function declareRouteBehaviour(
  route: RouteSpec,
  allowExternalHosts: (hosts: string[]) => void,
  expectConsoleErrors: (patterns: RegExp[]) => void,
): void {
  if (route.externalHosts) allowExternalHosts(route.externalHosts);
  if (route.expectedConsoleErrors) expectConsoleErrors(route.expectedConsoleErrors);
}

/** The persona that should be able to see a route. */
function authorisedPersona(route: RouteSpec): Persona {
  switch (route.gate) {
    case "admin":
    case "admin-or-reviewer":
      return "admin";
    case "auth":
      return "free";
    case "public":
      return "free";
  }
}

test.describe("every route renders", () => {
  for (const route of ROUTES) {
    if (route.skipRender) {
      test.skip(`${route.path} — ${route.skipRender}`, () => {});
      continue;
    }

    test(`${route.path}`, async ({ page, signInAs, allowExternalHosts, expectConsoleErrors }) => {
      declareRouteBehaviour(route, allowExternalHosts, expectConsoleErrors);
      await signInAs(authorisedPersona(route));
      await page.goto(concreteUrl(route));

      if (route.redirectsTo) {
        await expect(page).toHaveURL(
          new RegExp(`${route.redirectsTo === "/" ? "\\/" : route.redirectsTo}$`),
        );
        return;
      }

      await expectRendered(page, route);
    });
  }
});

test.describe("every route survives an unknown id", () => {
  // A page that assumes its record exists is a page that white-screens on a
  // stale link. Nothing seeds the fixture here, so every :param resolves to
  // nothing.
  const dynamic = ROUTES.filter((route) => route.path.includes(":") && !route.skipRender);

  for (const route of dynamic) {
    test(`${route.path}`, async ({ page, signInAs, allowExternalHosts, expectConsoleErrors }) => {
      declareRouteBehaviour(route, allowExternalHosts, expectConsoleErrors);
      await signInAs(authorisedPersona(route));
      await page.goto(concreteUrl(route));

      await expectRendered(page, route);
    });
  }
});

test.describe("signed-out visitors are turned away from private routes", () => {
  const guarded = ROUTES.filter((route) => route.gate === "auth" && !route.skipRender);

  for (const route of guarded) {
    test(`${route.path} redirects to /auth`, async ({ page, signInAs }) => {
      await signInAs("anonymous");
      await page.goto(concreteUrl(route));

      await expect(page).toHaveURL(/\/auth$/);
    });
  }
});

test.describe("signed-out visitors are turned away from the admin console", () => {
  const adminRoutes = ROUTES.filter(
    (route) => route.gate === "admin" || route.gate === "admin-or-reviewer",
  );

  for (const route of adminRoutes) {
    test(`${route.path} redirects to /admin/login`, async ({ page, signInAs }) => {
      await signInAs("anonymous");
      await page.goto(concreteUrl(route));

      await expect(page).toHaveURL(/\/admin\/login$/);
    });
  }
});

test.describe("a plain learner cannot reach the admin console", () => {
  const adminRoutes = ROUTES.filter(
    (route) => route.gate === "admin" || route.gate === "admin-or-reviewer",
  );

  for (const route of adminRoutes) {
    test(`${route.path}`, async ({ page, signInAs }) => {
      await signInAs("free");
      await page.goto(concreteUrl(route));

      await expect(page).toHaveURL(/\/admin\/login$/);
    });
  }
});

test.describe("content reviewers are held to the rbac allow-list", () => {
  const allowed = ROUTES.filter((route) => route.gate === "admin-or-reviewer");
  const denied = ROUTES.filter((route) => route.gate === "admin");

  for (const route of allowed) {
    test(`reaches ${route.path}`, async ({
      page,
      signInAs,
      allowExternalHosts,
      expectConsoleErrors,
    }) => {
      declareRouteBehaviour(route, allowExternalHosts, expectConsoleErrors);
      await signInAs("content_reviewer");
      await page.goto(concreteUrl(route));

      await expectRendered(page, route);
      await expect(page.getByText(/Access Denied/i)).toHaveCount(0);
    });
  }

  for (const route of denied) {
    test(`is turned away from ${route.path}`, async ({ page, signInAs }) => {
      await signInAs("content_reviewer");
      await page.goto(concreteUrl(route));

      // Sent back to /admin rather than the login page, since they do hold a
      // privileged role.
      await expect(page).toHaveURL(/\/admin$/);
    });
  }
});

test.describe("the catch-all", () => {
  test("shows the 404 page for an unknown path", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/no-such-page");

    await waitForPage(page);
    await expect(page.getByText(NOT_FOUND)).toBeVisible();
  });

  test("does not swallow a real route that looks similar", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/curriculum");

    await waitForPage(page);
    await expect(page.getByText(NOT_FOUND)).toHaveCount(0);
  });
});
