import { expect, test } from "./support/fixtures";

/**
 * The corner control, which is two controls.
 *
 * Forty-eight pages reserve a slot in their top corner. It used to hold a home
 * button on every one of them — including the pages where the dock now offers
 * the identical destination forty pixels lower. So on those pages the slot
 * holds the profile emblem instead, and on the pages with no dock it stays the
 * home button, because those are the ones with no other way out.
 *
 * Getting this backwards is quiet in both directions: a duplicate home button
 * looks fine and wastes the corner, and a profile link on a page with no dock
 * strands someone mid-lesson. Neither shows up as a broken test elsewhere.
 */

test.describe("the corner control", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("is the way to your account wherever the dock is showing", async ({ page }) => {
    await page.goto("/reading");

    await page.getByRole("link", { name: /حسابك/ }).click();
    await expect(page).toHaveURL(/\/me$/);
  });

  test("stays a way out on the pages that have no dock", async ({ page }) => {
    await page.goto("/reset-password");

    // This route hides the dock, as every focused flow does. Swapping its only
    // escape hatch for a profile link would strand whoever landed on it.
    await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /حسابك/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "الرئيسية" })).toBeVisible();
  });

  test("leaves room under itself at desktop width", async ({ page }) => {
    // The page padding that clears the dock is set twice — once bare, once
    // under md: — and the md: one wins from 768px up. When it was the smaller
    // of the two, anything at the bottom of a page sat underneath the dock and
    // could not be tapped. The old bar was 47px and cleared the 48px it left
    // by a single pixel, so this stayed invisible until the bar was replaced.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/reading");

    const dock = await page.getByRole("navigation", { name: "التنقل الرئيسي" }).boundingBox();
    const padding = await page.evaluate(() => {
      const main = document.querySelector("main, [class*='max-w-2xl']") as HTMLElement;
      return parseFloat(getComputedStyle(main).paddingBottom);
    });

    expect(padding).toBeGreaterThanOrEqual(dock!.height);
  });

  test("does not offer the same destination twice", async ({ page }) => {
    await page.goto("/reading");

    // The dock owns "home" now. A second home control in the corner is the
    // duplication this swap exists to remove.
    await expect(page.getByRole("button", { name: "الرئيسية" })).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("link", { name: "الرئيسية" }),
    ).toBeVisible();
  });
});
