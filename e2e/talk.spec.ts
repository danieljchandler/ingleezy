import { expect, test } from "./support/fixtures";

/**
 * تكلّم: everything a learner says.
 *
 * The tab exists because "ask" had four doors while the tutor call had none in
 * the navigation. It is a short page rather than a straight link to
 * /conversation because that page starts a live voice call the moment it
 * loads — right when you chose to call, wrong when you only tapped a tab.
 */

test.describe("the Talk tab", () => {
  test.beforeEach(async ({ signInAs, page }) => {
    await signInAs("free");
    await page.goto("/talk");
  });

  test("leads with the tutor call, one deliberate tap away", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "مكالمة مع المعلّم" })).toBeVisible();
    // Arriving here must not have started a call already.
    await expect(page).toHaveURL(/\/talk$/);
  });

  test("lists the speaking tools", async ({ page }) => {
    for (const [name, path] of [
      [/كيف أقول…؟/, /\/how-do-i-say$/],
      [/^النطق/, /\/pronunciation$/],
    ] as const) {
      await page.goto("/talk");
      await page.getByRole("link", { name }).click();
      await expect(page).toHaveURL(path);
    }
  });

  test("is lit in the dock", async ({ page }) => {
    await expect(
      page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("link", { name: "تكلّم" }),
    ).toHaveAttribute("aria-current", "page");
  });
});
