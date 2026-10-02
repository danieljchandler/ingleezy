import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, aProfile, videoId } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The Watch screen: one video, its transcript, and four tools for a line.
 *
 * Two kinds of video share it, and they store their lines opposite ways round.
 * On this app's own English uploads `english` is the line as spoken and
 * `arabic` its dialect scaffold; on videos bridged from Hakiya the speech is
 * Arabic and `translation` is its English. The page used to render `arabic` as
 * the spoken line on both — so on an English video, the English being studied
 * never appeared at all. That is the main thing pinned here.
 */

const ENGLISH_LINES = [
  {
    id: "l0",
    english: "So how was the drive back?",
    arabic: "طيب، شلون كانت الرجعة؟",
    literal: "إذن كيف كانت الرجعة؟",
    startMs: 1000,
    endMs: 4000,
    tokens: [],
  },
  {
    id: "l1",
    english: "Honestly, that was rough.",
    arabic: "بصراحة، كانت صعبة.",
    startMs: 4000,
    endMs: 7000,
    tokens: [],
  },
];

const ARABIC_LINES = [
  { id: "a0", arabic: "شلونك اليوم؟", translation: "How are you today?", startMs: 0, endMs: 3000, tokens: [] },
];

function seedVideo(db: MemoryDb, lines: unknown[], over: Record<string, unknown> = {}) {
  db.seed("discover_videos", [
    aDiscoverVideo({
      id: videoId(0),
      title: "The long drive home",
      title_arabic: "مشوار طويل للبيت",
      transcript_lines: lines,
      ...over,
    }),
  ]);
  db.seed("video_likes", []);
  db.seed("video_ratings", []);
  db.seed("user_vocabulary", []);
}

test.beforeEach(async ({ signInAs, allowExternalHosts }) => {
  // The YouTube player loads its iframe API from youtube.com. The fixture
  // blocks it, and the page carries on without a picture — which is all a
  // transcript test needs.
  allowExternalHosts(["youtube.com"]);
  await signInAs("free");
});

const transcript = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "النص" }).getByRole("listitem");

test.describe("an English video", () => {
  test.beforeEach(async ({ db, page }) => {
    seedVideo(db, ENGLISH_LINES);
    await page.goto(`/discover/${videoId(0)}`);
  });

  test("shows the English as spoken, with the dialect scaffold under it", async ({ page }) => {
    const first = transcript(page).first();
    await expect(first).toContainText("So how was the drive back?");
    await expect(first).toContainText("طيب، شلون كانت الرجعة؟");
  });

  test("hides the scaffold when the translation is switched off", async ({ page }) => {
    await page.getByRole("switch", { name: "الترجمة بالخليجي" }).click();

    await expect(transcript(page).first()).toContainText("So how was the drive back?");
    await expect(page.getByText("طيب، شلون كانت الرجعة؟")).toHaveCount(0);
  });

  test("makes each English word a thing to tap", async ({ page }) => {
    await transcript(page).nth(1).getByRole("button", { name: "rough." }).click();

    await expect(page.getByRole("button", { name: "احفظ في كلماتي" })).toBeVisible();
  });

  test("saves a tapped word with the English as the word and the line as context", async ({
    page,
    db,
  }) => {
    await transcript(page).nth(1).getByRole("button", { name: "rough." }).click();
    await page.getByRole("button", { name: "احفظ في كلماتي" }).click();

    await expect.poll(() => db.rows("user_vocabulary").length).toBe(1);
    expect(db.rows("user_vocabulary")[0]).toMatchObject({
      word_english: "rough",
      sentence_english: "Honestly, that was rough.",
      sentence_text: "بصراحة، كانت صعبة.",
      source: "discover",
    });
  });

  test("names each line's start, so a line can be played from the keyboard", async ({ page }) => {
    await expect(page.getByRole("button", { name: "شغّل من 0:04" })).toBeVisible();
  });
});

test.describe("an Arabic video", () => {
  test("shows the Arabic speech first, with its English under it", async ({ db, page }) => {
    seedVideo(db, ARABIC_LINES, { source: "hakiya", title: "Small talk at work" });
    await page.goto(`/discover/${videoId(0)}`);

    const first = transcript(page).first();
    await expect(first).toContainText("شلونك اليوم؟");
    await expect(first).toContainText("How are you today?");
    await expect(page.getByRole("switch", { name: "الترجمة بالإنجليزي" })).toBeVisible();
  });
});

test.describe("the toolbar", () => {
  test.beforeEach(async ({ db, page }) => {
    seedVideo(db, ENGLISH_LINES);
    await page.goto(`/discover/${videoId(0)}`);
  });

  test("steps through the speeds and back to normal", async ({ page }) => {
    const bar = page.getByRole("navigation", { name: "أدوات المقطع" });
    for (const speed of ["0.75", "0.5", "1.25", "1"]) {
      await bar.getByRole("button", { name: /السرعة/ }).click();
      await expect(bar.getByRole("button", { name: `السرعة ${speed}×` })).toBeVisible();
    }
  });

  test("says when it will stop after each line", async ({ page }) => {
    const pause = page.getByRole("button", { name: "وقفة بعد السطر" });
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    await pause.click();
    await expect(pause).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("leaving", () => {
  test("goes to the library from a link opened cold", async ({ db, page }) => {
    seedVideo(db, ENGLISH_LINES);
    await page.goto(`/discover/${videoId(0)}`);

    await page.getByRole("button", { name: "رجوع" }).click();

    await expect(page).toHaveURL(/\/library$/);
  });

  test("goes back to where the learner came from", async ({ db, backend, page }) => {
    seedVideo(db, ENGLISH_LINES);
    db.seed("profiles", [aProfile({ placement_level: null, placement_level_gulf: null })]);
    backend.stubFunction("discover-feed", { items: [], cold_start: false, seed: 1 });
    await page.goto("/discover");
    await page.getByRole("tab", { name: "تصفح" }).click();
    await page.getByRole("button", { name: /The long drive home/ }).click();
    await expect(transcript(page).first()).toContainText("So how was the drive back?");

    await page.getByRole("button", { name: "رجوع" }).click();

    await expect(page).toHaveURL(/\/discover$/);
  });
});
