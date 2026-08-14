import { expect, test, type Page } from "./support/fixtures";
import { aProfile, aUserXp } from "../src/test/support/factories";

/**
 * The Ask AI panel has to leave the learner looking at whatever they asked
 * about. It's non-modal and only takes part of the screen, which means two
 * things that unit tests can't see: the page behind it is still on screen and
 * still clickable, and the panel doesn't cover the reading material.
 *
 * The dismiss-on-outside-click guard is the fragile one. Radix dismisses a
 * non-modal dialog on any outside pointerdown by default, so losing the guard
 * would silently restore the old "panel closes the moment you touch the page"
 * behaviour while every other test stayed green.
 */

const PASSAGE = {
  title: "في المقهى",
  titleEnglish: "At the cafe",
  passage: "رحت المقهى الصبح. طلبت قهوة.",
  passageEnglish: "I went to the cafe in the morning. I ordered a coffee.",
  lines: [
    { arabic: "رحت المقهى الصبح.", english: "I went to the cafe in the morning." },
    { arabic: "طلبت قهوة.", english: "I ordered a coffee." },
  ],
  vocabulary: [{ arabic: "مقهى", english: "cafe" }],
  questions: [
    {
      question: "Where did the writer go?",
      options: [
        { text: "To the cafe", correct: true },
        { text: "To the market", correct: false },
      ],
    },
  ],
};

const openPanel = async (page: Page) => {
  await page.getByRole("button", { name: "Ask AI" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

test.describe("Ask AI panel", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("reading_passages", []);
    db.seed("user_xp", [aUserXp()]);
    backend.stubFunction("reading-passage", { passage: PASSAGE });
  });

  test("leaves the page visible above it on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reading");

    const heading = page.getByRole("heading", { name: /تمرين القراءة/ });
    await expect(heading).toBeVisible();

    await openPanel(page);

    // The panel peeks from the bottom, so the top of the page is untouched.
    const dialog = page.getByRole("dialog");
    const panel = (await dialog.boundingBox())!;
    expect(panel.y).toBeGreaterThan(844 * 0.35);
    await expect(heading).toBeInViewport();

    await page.screenshot({ path: "/tmp/ask-ai-mobile-peek.png" });
  });

  test("does not close when the page behind it is clicked", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /تمرين القراءة/ })).toBeVisible();
    await openPanel(page);

    // Tapping the page is how you'd pause a video or pick another line. It must
    // not dismiss the panel.
    await page.getByRole("heading", { name: /تمرين القراءة/ }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("expands and collapses between the two heights", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /تمرين القراءة/ })).toBeVisible();
    await openPanel(page);

    const dialog = page.getByRole("dialog");
    const peekTop = (await dialog.boundingBox())!.y;

    await page.getByRole("button", { name: "Expand panel" }).click();
    await expect(page.getByRole("button", { name: "Collapse panel" })).toBeVisible();
    const fullTop = (await dialog.boundingBox())!.y;
    expect(fullTop).toBeLessThan(peekTop);

    await page.screenshot({ path: "/tmp/ask-ai-mobile-full.png" });

    await page.getByRole("button", { name: "Collapse panel" }).click();
    await expect(page.getByRole("button", { name: "Expand panel" })).toBeVisible();
  });

  test("shows the sentence it was opened about, with the passage still on screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reading");
    await page.getByText("اقرأ نصاً").click();
    await page.getByRole("button", { name: /مبتدئ/ }).click();

    // The flipped passage renders one tappable ENGLISH word per span; the
    // Arabic scaffold sits behind each line's reveal.
    const line = page.getByRole("button", { name: "cafe", exact: true }).first();
    await expect(line).toBeVisible();

    // The per-line chip and the floating action button share the name "Ask AI";
    // the chip comes first, the FAB is mounted last in the shell.
    await page.getByRole("button", { name: "Ask AI" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // The card names the sentence, and the passage is still readable above it.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Sentence")).toBeVisible();
    await expect(dialog.getByText("رحت المقهى الصبح.").first()).toBeVisible();
    await expect(line).toBeInViewport();

    await page.screenshot({ path: "/tmp/ask-ai-seeded.png" });
  });

  test("does not dim the page on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/reading");
    await expect(page.getByRole("heading", { name: /تمرين القراءة/ })).toBeVisible();
    await openPanel(page);

    // The old panel painted a bg-black/80 scrim over everything.
    const dialog = page.getByRole("dialog");
    const panel = (await dialog.boundingBox())!;
    expect(panel.width).toBeLessThan(1440 * 0.5);
    await expect(page.getByRole("heading", { name: /تمرين القراءة/ })).toBeInViewport();

    await page.screenshot({ path: "/tmp/ask-ai-desktop.png" });
  });
});
