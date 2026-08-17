import { expect, test } from "./support/fixtures";

/**
 * The chooser, which replaced three hub screens carrying 41 entries.
 *
 * What made those hard to use was not the count so much as the sameness: every
 * row was a rounded card with an icon chip, so nothing on screen said which one
 * mattered. Here four skills are blocks you cannot confuse, three verbs are
 * visibly a different kind of thing, and the long tail is not on screen at all.
 *
 * The distinction these tests protect is skills-versus-verbs. Reading, writing,
 * speaking and listening are a closed set that each own a full page; upload,
 * ask and games are utilities applied to whatever is in front of you. Flatten
 * them into one grid and the eye starts comparing things that are not alike.
 */

test.describe("choosing what to do", () => {
  test.beforeEach(async ({ signInAs, page }) => {
    await signInAs("free");
    await page.goto("/choose");
  });

  test("offers the four skills", async ({ page }) => {
    for (const label of ["استماع", "قراءة", "تحدّث", "كتابة"]) {
      await expect(page.getByRole("link", { name: new RegExp(label) })).toBeVisible();
    }
  });

  test("sends a skill to its own page, never a sheet over the feed", async ({ page }) => {
    await page.getByRole("link", { name: /تحدّث/ }).click();

    // Speaking needs a microphone and writing needs a keyboard. Both deserve
    // the whole screen rather than half of it above a playing video, so these
    // navigate rather than opening a panel.
    await expect(page).toHaveURL(/\/pronunciation$/);
    await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toHaveCount(0);
  });

  test("announces the learning path instead of hiding it", async ({ page }) => {
    // A path is sequential and a feed is the opposite, so the lessons get their
    // own door. It is visible now so the shape of the app is honest, and
    // disabled until it is genuinely ready — a dead link would be worse.
    const path = page.getByText("مسار التعلّم");
    await expect(path).toBeVisible();
    await expect(page.getByText("قريباً")).toBeVisible();
    await expect(page.getByRole("link", { name: /مسار التعلّم/ })).toHaveCount(0);
  });

  test("goes back to the feed", async ({ page }) => {
    await page.getByRole("link", { name: /الفيديو/ }).click();

    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });
});
