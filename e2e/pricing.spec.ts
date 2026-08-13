import { expect, test } from "./support/fixtures";
import type { Page } from "@playwright/test";

/**
 * Pricing — the only page in the app that takes money.
 *
 * Two things make it worth testing carefully out of proportion to its size.
 *
 * First, the tier is not in Postgres. `subscribers` exists as a table, but
 * `useSubscription` ignores it and asks `check-subscription`, which reads
 * Stripe. So every branch on this page hangs off one edge-function response,
 * and a mis-shaped response degrades to "free" silently — a paying subscriber
 * shown the Subscribe button, with no error anywhere.
 *
 * Second, checkout leaves the app. `createCheckout` opens Stripe in a new tab
 * via `window.open`, which a spec cannot follow. The assertion that matters is
 * therefore the one about what URL was opened, and the fixture records
 * `window.open` rather than performing it (src/test/support/browser/fakes.ts).
 */

/** URLs the page handed to `window.open`. */
const openedUrls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __openedUrls: string[] }).__openedUrls);

test.describe("what each visitor is shown", () => {
  test("shows all three plans to a signed-out visitor", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/pricing");

    // Deliberately not behind ProtectedRoute: the page has to work for someone
    // deciding whether to make an account at all.
    // Exact, because the FAQ below repeats "free", "Standard" and "All-In" in
    // its own headings.
    await expect(page.getByRole("heading", { name: "Choose Your Plan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Free", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Standard", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All-In", exact: true })).toBeVisible();
  });

  test("asks a signed-out visitor to sign up rather than to subscribe", async ({
    page,
    signInAs,
  }) => {
    await signInAs("anonymous");

    await page.goto("/pricing");

    await expect(page.getByRole("button", { name: "Sign Up to Subscribe" })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toHaveCount(0);
  });

  test("sends a signed-out visitor to sign in when they pick a plan", async ({
    page,
    signInAs,
  }) => {
    await signInAs("anonymous");
    await page.goto("/pricing");

    await page.getByRole("button", { name: "Sign Up to Subscribe" }).first().click();

    await expect(page).toHaveURL(/\/auth/);
  });

  test("offers both paid plans to a free learner", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/pricing");

    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(2);
    // The free card's button is inert — there is nothing to buy.
    await expect(page.getByRole("button", { name: "Current Plan" })).toBeDisabled();
  });

  test("marks the plan a Standard subscriber is already on", async ({ page, signInAs }) => {
    await signInAs("standard");

    await page.goto("/pricing");

    await expect(page.getByText("You're on the Standard plan")).toBeVisible();
    await expect(page.getByText("Your Plan", { exact: true })).toBeVisible();
    // Standard subscribers can still see the upgrade, and only the upgrade.
    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(1);
  });

  test("marks an All-In subscriber's plan and offers them the portal", async ({
    page,
    signInAs,
  }) => {
    await signInAs("allin");

    await page.goto("/pricing");

    await expect(page.getByText("You're on the All-In plan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage Subscription" })).toHaveCount(1);
  });

  test("offers an All-In subscriber a Standard checkout", async ({ page, signInAs, backend }) => {
    await signInAs("allin");

    await page.goto("/pricing");
    await expect(page.getByText("You're on the All-In plan")).toBeVisible();

    // A finding, pinned as-is. Each card branches on `tier === <its own tier>`
    // and nothing compares rank, so the Standard card still renders Subscribe
    // for someone already on the more expensive plan. The FAQ tells them to
    // downgrade through Manage Subscription — this button instead starts a
    // *second* Stripe checkout for the cheaper plan, which is not the same
    // operation and is not what the copy on the page promises.
    await page.getByRole("button", { name: "Subscribe" }).click();

    await expect
      .poll(() => backend.lastCallTo("create-checkout")?.body)
      .toMatchObject({ tier: "standard" });
  });

  test("shows a subscriber the Subscribe buttons while their plan is still loading", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("standard");
    db.delayFunction("check-subscription", 3000);

    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "Choose Your Plan" })).toBeVisible();

    // A bug, pinned. The page does gate on `subLoading` — but `useSubscription`
    // clears that flag before it has an answer. Its effect runs first with
    // `user` still null, takes the else branch and sets `loading: false`
    // (useSubscription.ts:88); when `user` arrives, `checkSubscription` never
    // sets it back to true. So the spinner is gone for the whole round trip and
    // the page renders its default state: a paying Standard subscriber is
    // offered a Standard checkout for the plan they are already on.
    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(2);
    await expect(page.getByText(/You're on the/)).toHaveCount(0);

    // It does settle correctly once the answer lands — the window is the bug,
    // not the end state.
    await expect(page.getByText("You're on the Standard plan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(1);
  });
});

test.describe("starting a checkout", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("asks for a Standard checkout and opens what Stripe returns", async ({ page, backend }) => {
    backend.stubFunction("create-checkout", { url: "https://checkout.stripe.test/standard" });

    await page.goto("/pricing");
    await page.getByRole("button", { name: "Subscribe" }).first().click();

    await expect.poll(() => openedUrls(page)).toContain("https://checkout.stripe.test/standard");
    expect(backend.lastCallTo("create-checkout")?.body).toMatchObject({ tier: "standard" });
  });

  test("asks for an All-In checkout from the All-In card", async ({ page, backend }) => {
    backend.stubFunction("create-checkout", { url: "https://checkout.stripe.test/allin" });

    await page.goto("/pricing");
    await page.getByRole("button", { name: "Subscribe" }).last().click();

    // The two cards differ only in which tier they send. Crossing them wires a
    // learner to the wrong price with no visible sign until the Stripe page.
    await expect
      .poll(() => backend.lastCallTo("create-checkout")?.body)
      .toMatchObject({ tier: "allin" });
  });

  test("carries the session token to the checkout function", async ({ page, backend }) => {
    backend.stubFunction("create-checkout", { url: "https://checkout.stripe.test/standard" });

    await page.goto("/pricing");
    await page.getByRole("button", { name: "Subscribe" }).first().click();

    // The function identifies the customer from this header. Without it a
    // checkout is created against nobody.
    await expect
      .poll(() => backend.lastCallTo("create-checkout")?.headers.authorization)
      .toMatch(/^Bearer \S+/);
  });

  test("reports a failed checkout rather than doing nothing visible", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("create-checkout");

    await page.goto("/pricing");
    await page.getByRole("button", { name: "Subscribe" }).first().click();

    await expect(page.getByText("Failed to start checkout. Please try again.")).toBeVisible();
  });

  test("opens nothing when the function answers without a URL", async ({ page, backend }) => {
    backend.stubFunction("create-checkout", { url: null });

    await page.goto("/pricing");
    await page.getByRole("button", { name: "Subscribe" }).first().click();
    await expect.poll(() => backend.callsTo("create-checkout").length).toBe(1);

    // `window.open(undefined)` navigates a blank tab to about:blank, which
    // looks to a learner like a checkout that failed to load.
    expect(await openedUrls(page)).toHaveLength(0);
  });
});

test.describe("managing an existing subscription", () => {
  test("opens the Stripe portal from the banner", async ({ page, signInAs, backend }) => {
    await signInAs("standard");
    backend.stubFunction("customer-portal", { url: "https://billing.stripe.test/portal" });

    await page.goto("/pricing");
    await page.getByRole("button", { name: "Manage", exact: true }).click();

    await expect.poll(() => openedUrls(page)).toContain("https://billing.stripe.test/portal");
  });

  test("opens the same portal from the plan card", async ({ page, signInAs, backend }) => {
    await signInAs("standard");
    backend.stubFunction("customer-portal", { url: "https://billing.stripe.test/portal" });

    await page.goto("/pricing");
    await page.getByRole("button", { name: "Manage Subscription" }).click();

    // Cancelling and switching plans both live behind this one button, so
    // there is no in-app path to either if it silently does nothing.
    await expect.poll(() => openedUrls(page)).toContain("https://billing.stripe.test/portal");
  });

  test("reports a portal that will not open", async ({
    page,
    signInAs,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await signInAs("standard");
    backend.stubFunctionFailure("customer-portal");

    await page.goto("/pricing");
    await page.getByRole("button", { name: "Manage", exact: true }).click();

    await expect(
      page.getByText("Failed to open subscription management. Please try again."),
    ).toBeVisible();
  });
});

test.describe("when Stripe cannot be reached", () => {
  test("falls back to free rather than to an error", async ({
    page,
    signInAs,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Error checking subscription/]);
    await signInAs("allin");
    backend.stubFunctionFailure("check-subscription");

    await page.goto("/pricing");

    // Recording a consequence, not a bug in the page. `checkSubscription`
    // leaves the state at its defaults on error, so a Stripe outage shows a
    // paying All-In subscriber the two Subscribe buttons and no indication
    // that anything went wrong — the failure is only in the console.
    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(2);
    await expect(page.getByText(/You're on the/)).toHaveCount(0);
  });

  test("treats a subscription with no tier as unsubscribed", async ({
    page,
    signInAs,
    backend,
  }) => {
    await signInAs("standard");
    // What the function returns when Stripe reports an active subscription for
    // a product the tier map does not recognise — a renamed or newly added
    // Stripe product does exactly this.
    backend.stubFunction("check-subscription", {
      subscribed: true,
      tier: null,
      product_id: "prod_unknown",
      subscription_end: null,
    });

    await page.goto("/pricing");

    // The banner needs both `subscribed` and `tier`, so an unmapped product
    // pays without showing a plan. Worth knowing before adding a Stripe price.
    await expect(page.getByText(/You're on the/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(2);
  });
});

test.describe("what the page promises", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("prices the two paid plans", async ({ page }) => {
    await page.goto("/pricing");

    // Pinned deliberately. These are the numbers in `SUBSCRIPTION_TIERS`, which
    // also carries the Stripe price ids — changing one without the other bills
    // an amount the page never showed.
    await expect(page.getByText("$5")).toBeVisible();
    await expect(page.getByText("$15")).toBeVisible();
    await expect(page.getByText("$0")).toBeVisible();
  });

  test("states the vocabulary limits the free tier is capped by", async ({ page }) => {
    await page.goto("/pricing");

    await expect(page.getByText("10 vocabulary words")).toBeVisible();
    await expect(page.getByText("100 vocabulary words")).toBeVisible();
    await expect(page.getByText("Unlimited vocabulary storage")).toBeVisible();
  });

  test("answers the questions a buyer asks before paying", async ({ page }) => {
    await page.goto("/pricing");

    await expect(page.getByRole("heading", { name: "Frequently asked questions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Can I switch plans or cancel later?" })).toBeVisible();
    await expect(page.getByText(/7-day money-back guarantee/).first()).toBeVisible();
  });
});
