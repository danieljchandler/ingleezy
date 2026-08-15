import { expect, test } from "./support/fixtures";
import {
  anAuthenticStory,
  anAuthenticStoryLine,
  storyId,
  storyLineId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The reading library — real English texts, read line by line, with the
 * learner's dialect beside them.
 *
 * This surface was the last one still running Hakiya's direction: it imported
 * Arabic texts and rendered them Arabic-primary with English underneath.
 * Nothing errored, because the whole path agreed with itself — it was simply
 * the wrong app, handing an Arabic speaker Arabic reading practice.
 *
 * So what these tests hold in place is the direction. The English is the text:
 * always visible, tappable word by word, and what the audio narrates. The
 * Arabic is help, and help can be switched off. A reader that quietly swapped
 * them would still render, still scroll and still play — which is exactly why
 * it went unnoticed for as long as it did.
 */

const STORY = storyId(0);

function seedStory(
  db: MemoryDb,
  over: Record<string, unknown> = {},
  lines: Array<Record<string, unknown>> = [],
) {
  db.seed("authentic_stories", [
    anAuthenticStory({
      id: STORY,
      title: "Market day",
      title_arabic: "يوم السوق",
      author: "A. Writer",
      source_name: "The Example Post",
      body_english: "The market opens at dawn.",
      status: "published",
      ...over,
    }),
  ]);
  db.seed(
    "authentic_story_lines",
    lines.length
      ? lines
      : [
          anAuthenticStoryLine({
            id: storyLineId(0),
            story_id: STORY,
            line_index: 0,
            english: "The market opens at dawn.",
            arabic: "السوق يفتح مع الفجر.",
            english_literal: "الـ سوق يفتح عند الـ فجر.",
            audio_url: null,
          }),
          anAuthenticStoryLine({
            id: storyLineId(1),
            story_id: STORY,
            line_index: 1,
            english: "Traders arrive early.",
            arabic: "التجّار يوصلون بدري.",
            english_literal: "الـ تجّار يوصلون بدري.",
            audio_url: null,
          }),
        ],
  );
}

test.describe("the library shelf", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("lists a story by its English title", async ({ page, db }) => {
    seedStory(db);

    await page.goto("/reading-library");

    await expect(page.getByText("Market day")).toBeVisible();
    // The dialect title rides along as the recognisable handle, not as the name.
    await expect(page.getByText("يوم السوق")).toBeVisible();
  });

  test("opens a story", async ({ page, db }) => {
    seedStory(db);

    await page.goto("/reading-library");
    await page.getByText("Market day").click();

    await expect(page).toHaveURL(new RegExp(`/reading-library/${STORY}$`));
  });
});

test.describe("reading a story", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedStory(db);
  });

  test("shows the English as the text", async ({ page }) => {
    await page.goto(`/reading-library/${STORY}`);

    await expect(page.getByText("Traders arrive early.")).toBeVisible();
  });

  test("shows the dialect beside it by default", async ({ page }) => {
    // A learner who opens a story and sees only English has no way to know the
    // help exists, and the help is the reason to read here rather than anywhere
    // else on the internet.
    await page.goto(`/reading-library/${STORY}`);

    await expect(page.getByText("التجّار يوصلون بدري.").first()).toBeVisible();
  });

  test("hides the dialect when the learner turns it off", async ({ page }) => {
    await page.goto(`/reading-library/${STORY}`);
    await expect(page.getByText("التجّار يوصلون بدري.").first()).toBeVisible();

    await page.getByLabel("ورّني العربي").click();

    // The English stays — it is the text, and there is no toggle that removes
    // it. Only the scaffold can be switched off.
    await expect(page.getByText("التجّار يوصلون بدري.")).toHaveCount(0);
    await expect(page.getByText("Traders arrive early.")).toBeVisible();
  });

  test("keeps the English when the scaffold is off", async ({ page }) => {
    await page.goto(`/reading-library/${STORY}`);
    await page.getByLabel("ورّني العربي").click();

    await expect(page.getByText("The market opens at dawn.").first()).toBeVisible();
  });

  test("credits the source", async ({ page }) => {
    // The library republishes other people's writing, so attribution is the
    // difference between citing and taking.
    await page.goto(`/reading-library/${STORY}`);

    await expect(page.getByText("A. Writer")).toBeVisible();
    await expect(page.getByText("The Example Post")).toBeVisible();
  });

  test("says so when the story is gone", async ({ page }) => {
    await page.goto(`/reading-library/${storyId(9)}`);

    await expect(page.getByText("ما لقينا القصة")).toBeVisible();
  });
});

test.describe("a story mid-import", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("renders the lines that do have English", async ({ page, db }) => {
    // The importer drops a line it could not gloss rather than failing the
    // whole batch, so a story can legitimately arrive short. It should read as
    // a shorter story, not a broken one.
    seedStory(db, {}, [
      anAuthenticStoryLine({
        id: storyLineId(0),
        story_id: STORY,
        line_index: 0,
        english: "The market opens at dawn.",
        arabic: "السوق يفتح مع الفجر.",
        audio_url: null,
      }),
    ]);

    await page.goto(`/reading-library/${STORY}`);

    await expect(page.getByText("The market opens at dawn.").first()).toBeVisible();
    await expect(page.getByText("1 / 1")).toBeVisible();
  });
});
