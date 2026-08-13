import { expect, test } from "./support/fixtures";

/**
 * Role and subscription gating.
 *
 * None of this was testable before the in-memory backend landed. `useAdminAuth`
 * resolves all three of its role checks through `rpc("has_role")`, which the
 * previous double answered `null` to, so every one of the 38 admin routes was
 * out of reach; and `useSubscription` reads the `check-subscription` edge
 * function, which it answered `{}` to, so every premium gate was too.
 */

test.describe("admin console access", () => {
  test("an admin reaches the dashboard", async ({ page, signInAs }) => {
    await signInAs("admin");
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(/Gulf Arabic Module/)).toBeVisible();
  });

  test("a signed-out visitor is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("a plain learner is turned away", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("a recorder has general admin access", async ({ page, signInAs }) => {
    await signInAs("recorder");
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin$/);
  });

  test.describe("content reviewer", () => {
    // The allow-list in src/lib/rbac.ts: /admin itself plus videos, set-phrases
    // and dialect-rules. Everything else is admin/recorder only.
    for (const path of ["/admin", "/admin/videos", "/admin/set-phrases", "/admin/dialect-rules"]) {
      test(`reaches ${path}`, async ({ page, signInAs }) => {
        await signInAs("content_reviewer");
        await page.goto(path);

        await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}$`));
      });
    }

    for (const path of ["/admin/topics", "/admin/invite-codes", "/admin/coverage"]) {
      test(`is redirected away from ${path}`, async ({ page, signInAs }) => {
        await signInAs("content_reviewer");
        await page.goto(path);

        // Sent back to /admin, since they do hold a privileged role.
        await expect(page).toHaveURL(/\/admin$/);
        await expect(page.getByText(/Access Denied/i)).toBeVisible();
      });
    }
  });
});

test.describe("subscription tiers", () => {
  /**
   * These record what the app does today, and today it does not gate on tier.
   *
   * `src/lib/featureAccess.ts` declares four Standard features (transcribe,
   * meme_analyzer, how_do_i_say, learn_from_x), four All-In ones, and vocabulary
   * caps of 10/100 — and `RequireSubscription` implements the paywall for them.
   * But nothing in the app imports `RequireSubscription`, `useFeatureAccess`,
   * `FEATURE_REQUIREMENTS` or either limit constant: the whole gate is wired up
   * to nothing, so every plan gets every feature. `useSubscription` is reached
   * only by the Pricing and Settings pages, for checkout and management.
   *
   * Free users are still limited on the AI endpoints, but by the server-side
   * daily caps in `supabase/functions/_shared/usageCap.ts`, which is a different
   * mechanism with different limits.
   *
   * If someone wires the gate up, these will fail — which is the point. Update
   * them then to assert the paywall instead.
   */
  const standardTierTools = ["/transcribe", "/meme", "/how-do-i-say", "/learn-from-x"];

  for (const path of standardTierTools) {
    test(`a free learner reaches ${path} — the tier gate is not wired up`, async ({
      page,
      signInAs,
    }) => {
      await signInAs("free");
      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}$`));
      await expect(page.getByText(/premium feature/i)).toHaveCount(0);
    });
  }

  test("a subscriber reaches them too", async ({ page, signInAs }) => {
    await signInAs("standard");
    await page.goto("/transcribe");

    await expect(page.getByText(/premium feature/i)).toHaveCount(0);
  });

  test("the pricing page offers both plans", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/pricing");

    await expect(page.getByText(/standard/i).first()).toBeVisible();
    await expect(page.getByText(/all.?in/i).first()).toBeVisible();
  });
});
