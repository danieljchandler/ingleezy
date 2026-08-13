import { expect, test, type Page } from "./support/fixtures";
import {
  aProfile,
  aUserPhrase,
  aUserVocabulary,
  phraseId,
  vocabId,
} from "../src/test/support/factories";

/**
 * Settings and the pricing page — everything that changes the account itself.
 *
 * Settings is the only screen where a learner can undo an onboarding choice, and
 * the fields it writes are read by nearly every other page: `preferred_dialect`
 * drives the theme and the query keys, `interests` and `learning_reason` are fed
 * verbatim into content generation, `show_on_leaderboard` decides whether their
 * name is public. A save that quietly drops one of those is invisible until the
 * consequence turns up somewhere else entirely, so each is asserted against the
 * persisted row.
 *
 * Checkout and the billing portal hand off by opening a Stripe URL in a new tab.
 * `installBrowserFakes` records those rather than letting the popup navigate —
 * see src/test/support/browser/fakes.ts.
 */

/** URLs the page handed to window.open. */
const openedUrls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __openedUrls: string[] }).__openedUrls ?? []);

test.describe("loading the form", () => {
  test("fills every field from the stored profile", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [
      aProfile({
        display_name: "Sami",
        preferred_dialect: "Egyptian",
        proficiency_level: "elementary",
        weekly_goal: "serious",
        show_on_leaderboard: false,
        learning_reason: "Travel",
        interests: ["food", "sports"],
      }),
    ]);

    await page.goto("/settings");

    await expect(page.getByLabel(/display name/i)).toHaveValue("Sami");
    await expect(page.getByRole("button", { name: /Egyptian Arabic/ })).toHaveClass(
      /border-primary/,
    );
    // Stored as a label, selected by id — the round trip through
    // reasonIdFromLabel is what makes an edit possible rather than a re-pick.
    await expect(page.getByRole("button", { name: "✈️ Travel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: /Food & Travel/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("falls back to sensible defaults for a profile with nothing set", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("free");
    db.seed("profiles", [
      aProfile({
        display_name: null,
        preferred_dialect: null,
        proficiency_level: null,
        weekly_goal: null,
        learning_reason: null,
        interests: null,
      }),
    ]);

    await page.goto("/settings");

    await expect(page.getByLabel(/display name/i)).toHaveValue("");
    await expect(page.getByRole("button", { name: /Gulf Arabic/ })).toHaveClass(/border-primary/);
  });

  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/auth$/);
  });
});

test.describe("saving", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
  });

  test("writes every edited field", async ({ page, db }) => {
    await page.goto("/settings");

    await page.getByLabel(/display name/i).fill("Layla");
    await page.getByRole("button", { name: /Egyptian Arabic/ }).click();
    await page.getByRole("button", { name: /Elementary/ }).click();
    await page.getByRole("button", { name: /Intensive/ }).click();
    await page.getByRole("button", { name: /Work/ }).click();
    await page.getByRole("button", { name: /^save changes$/i }).click();

    await expect(page.getByText(/settings saved/i)).toBeVisible();

    const profile = db.rows("profiles")[0];
    expect(profile.display_name).toBe("Layla");
    expect(profile.preferred_dialect).toBe("Egyptian");
    expect(profile.proficiency_level).toBe("elementary");
    expect(profile.weekly_goal).toBe("intensive");
    expect(profile.learning_reason).toBe("Work");
  });

  test("stores a blank display name as null rather than an empty string", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ display_name: "Sami" })]);
    await page.goto("/settings");

    await page.getByLabel(/display name/i).fill("   ");
    await page.getByRole("button", { name: /^save changes$/i }).click();
    await expect(page.getByText(/settings saved/i)).toBeVisible();

    // The leaderboard falls back to the email prefix on null; an empty string
    // would render a nameless row instead.
    expect(db.rows("profiles")[0].display_name).toBeNull();
  });

  test("keeps the weekly targets in step with the goal", async ({ page, db }) => {
    await page.goto("/settings");

    await page.getByRole("button", { name: /Intensive/ }).click();
    await page.getByRole("button", { name: /^save changes$/i }).click();
    await expect(page.getByText(/settings saved/i)).toBeVisible();

    // Changing the goal here has to move the numbers the home ring measures
    // against, or the label and the progress bar disagree.
    const goal = db.rows("weekly_goals")[0];
    expect(Number(goal.target_reviews)).toBe(150);
    expect(Number(goal.target_xp)).toBe(750);
  });

  test("turns leaderboard visibility off", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ show_on_leaderboard: true })]);
    await page.goto("/settings");

    await page
      .locator("section")
      .filter({ hasText: "Show on Leaderboard" })
      .getByRole("switch")
      .click();
    await page.getByRole("button", { name: /^save changes$/i }).click();
    await expect(page.getByText(/settings saved/i)).toBeVisible();

    // This one is a privacy setting: failing to persist it publishes a name the
    // learner asked to hide.
    expect(db.rows("profiles")[0].show_on_leaderboard).toBe(false);
  });

  test("reports a failed save instead of claiming success", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await page.goto("/settings");

    await page.getByLabel(/display name/i).fill("Layla");
    db.failWrites("profiles", 500);
    await page.getByRole("button", { name: /^save changes$/i }).click();

    await expect(page.getByText(/failed to save settings/i)).toBeVisible();
    await expect(page.getByText(/settings saved/i)).toHaveCount(0);
  });

  test("offers dialects the app cannot actually switch to", async ({ page, db }) => {
    await page.goto("/settings");

    // Recording current behaviour, not endorsing it. DialectContext recognises
    // only Gulf, Egyptian and Yemeni; Settings offers six Gulf countries as if
    // they were separate modules and does not offer Yemeni at all. Picking
    // "Kuwaiti" saves, and every dialect-scoped query then falls back to Gulf
    // with nothing on screen to say so. Onboarding was fixed for exactly this;
    // Settings was not. This test fails when it is.
    await expect(page.getByRole("button", { name: /Kuwaiti/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Yemeni/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Kuwaiti/ }).click();
    await page.getByRole("button", { name: /^save changes$/i }).click();
    await expect(page.getByText(/settings saved/i)).toBeVisible();

    expect(db.rows("profiles")[0].preferred_dialect).toBe("Kuwaiti");
  });
});

test.describe("review preferences", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
  });

  test("clearing leeches resets both personal decks", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), is_leech: true, lapses: 9, production_lapses: 4 }),
    ]);
    db.seed("user_phrases", [aUserPhrase({ id: phraseId(0), is_leech: true, lapses: 8 })]);

    await page.goto("/settings");
    await page.getByRole("button", { name: /clear all leech flags/i }).click();
    await expect(page.getByText(/cleared all leech flags/i)).toBeVisible();

    // Both decks, and the lapse counters too — clearing the flag but leaving
    // lapses at 9 re-flags the card on the very next miss.
    expect(db.rows("user_vocabulary")[0]).toMatchObject({
      is_leech: false,
      lapses: 0,
      production_lapses: 0,
    });
    expect(db.rows("user_phrases")[0]).toMatchObject({ is_leech: false, lapses: 0 });
  });

  test("the leech toggle persists across a reload", async ({ page }) => {
    await page.goto("/settings");

    // Row-scoped, not section-scoped: the Review Preferences section now also
    // carries the recording-contribution switch.
    const leechRow = () =>
      page.locator("div.rounded-xl").filter({ hasText: /flag difficult cards/i });
    const toggle = leechRow().getByRole("switch");
    await expect(toggle).toBeChecked();
    await toggle.click();

    await page.reload();
    await expect(leechRow().getByRole("switch")).not.toBeChecked();
  });

  test("the root-families toggle persists across a reload", async ({ page }) => {
    await page.goto("/settings");

    const rootRow = () =>
      page.locator("div.rounded-xl").filter({ hasText: /related words from the same root/i });
    const toggle = rootRow().getByRole("switch");
    // On by default: the footnote only appears when a family actually exists,
    // so it is quiet until it has something to say.
    await expect(toggle).toBeChecked();
    await toggle.click();

    await page.reload();
    await expect(rootRow().getByRole("switch")).not.toBeChecked();
  });
});

test.describe("the subscription panel in settings", () => {
  test("a free learner is pointed at the plans", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);

    await page.goto("/settings");
    await expect(page.getByText("Free plan")).toBeVisible();

    await page.getByRole("button", { name: /view plans/i }).click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("a subscriber gets the billing portal instead", async ({ page, signInAs, backend, db }) => {
    await signInAs("standard");
    db.seed("profiles", [aProfile()]);
    backend.stubFunction("customer-portal", { url: "https://billing.stripe.com/session/abc" });

    await page.goto("/settings");
    await expect(page.getByText(/Active plan: Standard/)).toBeVisible();

    await page.getByRole("button", { name: /manage subscription/i }).click();

    await expect
      .poll(() => openedUrls(page))
      .toContain("https://billing.stripe.com/session/abc");
  });

  test("says so when the portal cannot be opened", async ({
    page,
    signInAs,
    backend,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await signInAs("allin");
    db.seed("profiles", [aProfile()]);
    backend.stubFunctionFailure("customer-portal");

    await page.goto("/settings");
    await page.getByRole("button", { name: /manage subscription/i }).click();

    // Silently doing nothing here reads as a broken button on the one screen
    // where a learner is trying to stop being charged.
    await expect(page.getByText(/unable to open subscription portal/i)).toBeVisible();
  });
});

test.describe("pricing", () => {
  test("shows all three plans", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/pricing");

    await expect(page.getByRole("heading", { name: /choose your plan/i })).toBeVisible();
    await expect(page.getByText("Free", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^subscribe$/i })).toHaveCount(2);
  });

  test("starts checkout for the tier that was clicked", async ({ page, signInAs, backend }) => {
    await signInAs("free");
    backend.stubFunction("create-checkout", { url: "https://checkout.stripe.com/pay/allin" });

    await page.goto("/pricing");
    await page.getByRole("button", { name: /^subscribe$/i }).last().click();

    await expect.poll(() => backend.callsTo("create-checkout").length).toBe(1);
    // The tier is the whole content of the request — sending the wrong one
    // charges the learner for a plan they did not choose.
    expect(backend.lastCallTo("create-checkout")?.body).toMatchObject({ tier: "allin" });
    await expect
      .poll(() => openedUrls(page))
      .toContain("https://checkout.stripe.com/pay/allin");
  });

  test("marks the plan the learner is already on", async ({ page, signInAs }) => {
    await signInAs("standard");
    await page.goto("/pricing");

    await expect(page.getByText("Your Plan", { exact: true })).toBeVisible();
    await expect(page.getByText(/You're on the/)).toBeVisible();
    // No second charge offered for the plan they already have.
    await expect(page.getByRole("button", { name: /^subscribe$/i })).toHaveCount(1);
  });

  test("sends a signed-out visitor to sign up rather than to Stripe", async ({
    page,
    signInAs,
    backend,
  }) => {
    await signInAs("anonymous");
    await page.goto("/pricing");

    await page.getByRole("button", { name: /sign up to subscribe/i }).first().click();

    await expect(page).toHaveURL(/\/auth$/);
    expect(backend.callsTo("create-checkout")).toHaveLength(0);
  });

  test("reports a checkout that could not be started", async ({
    page,
    signInAs,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await signInAs("free");
    backend.stubFunctionFailure("create-checkout");

    await page.goto("/pricing");
    await page.getByRole("button", { name: /^subscribe$/i }).first().click();

    await expect(page.getByText(/failed to start checkout/i)).toBeVisible();
  });
});
