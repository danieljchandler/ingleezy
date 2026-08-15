import { expect, test, type Page } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";

/**
 * Today's Story — a ~200-word ENGLISH story built out of the learner's own
 * deck, with its Arabic scaffold a preference away.
 *
 * The shape it is read in is the thing worth pinning. A 200-word block of a
 * language you are learning is the point at which a learner stops reading,
 * so the story is presented one English sentence to a card, every word
 * tappable for a dialect lookup, with the sentence's Arabic translation and
 * word-order gloss shown under it when the learner reads with the scaffold
 * on (the same global display preference the rest of the app uses).
 *
 * Newer stories arrive with the split already authored; a story whose split
 * was discarded falls back to splitting the English on punctuation, with the
 * whole-story Arabic below so nothing is lost.
 */

const today = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

const ENGLISH = ["The house is quiet.", "Ali went to work.", "He came back after sunset."];
const ARABIC = ["البيت هادي.", "راح علي للشغل.", "رجع بعد المغرب."];

const aStory = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: TEST_USER_ID,
  story_date: today(),
  dialect: "Gulf",
  title: "An ordinary day",
  body_english: ENGLISH.join(" "),
  body_arabic: ARABIC.join(" "),
  body_literal_arabic: "الـ بيت هادي. علي راح إلى الشغل. هو رجع بعد المغرب.",
  sentences: null,
  vocab_used: ["house"],
  new_words: ["work"],
  audio_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

const authoredSentences = ENGLISH.map((english, i) => ({
  english,
  arabic: ARABIC[i],
  literal: ["الـ بيت هادي.", "علي راح إلى الشغل.", "هو رجع بعد المغرب."][i],
}));

/** The learner's saved preference for seeing the Arabic scaffold. */
async function readWithScaffoldOn(page: Page) {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      "ingleezy:display-prefs",
      JSON.stringify({
        showArabic: true,
        showTashkil: true,
        showFormal: false,
        showEnglish: true,
      }),
    ),
  );
}

test.describe("reading today's story", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("breaks the story into one card per sentence, every word tappable", async ({
    page,
    db,
  }) => {
    db.seed("daily_vocab_stories", [aStory({ sentences: authoredSentences })]);

    await page.goto("/today/story");
    await expect(page.getByRole("heading", { name: "An ordinary day" })).toBeVisible();

    // Three sentences, three cards — and each word its own tap target is the
    // visible proof this is the reader, not a block of text.
    await expect(page.getByText(ENGLISH[0])).toBeVisible();
    await expect(page.getByText(ENGLISH[2])).toBeVisible();
    await expect(page.getByRole("button", { name: "quiet." })).toBeVisible();
    await expect(page.getByRole("button", { name: "sunset." })).toBeVisible();
  });

  test("keeps the Arabic scaffold behind the display preference", async ({ page, db }) => {
    db.seed("daily_vocab_stories", [aStory({ sentences: authoredSentences })]);

    await page.goto("/today/story");

    // Preference off: English only — the scaffold must not crowd the story.
    await expect(page.getByText(ENGLISH[0])).toBeVisible();
    await expect(page.getByText(ARABIC[0])).toHaveCount(0);
  });

  test("shows each line's Arabic and gloss for a learner reading with the scaffold on", async ({
    page,
    db,
  }) => {
    await readWithScaffoldOn(page);
    db.seed("daily_vocab_stories", [aStory({ sentences: authoredSentences })]);

    await page.goto("/today/story");

    await expect(page.getByText(ARABIC[1])).toBeVisible();
    await expect(page.getByText("علي راح إلى الشغل.")).toBeVisible();
  });

  test("splits a story that was stored as paragraphs", async ({ page, db }) => {
    // A story whose authored split was discarded: the page splits the English
    // itself, one sentence per card, scaffold-less.
    db.seed("daily_vocab_stories", [aStory()]);

    await page.goto("/today/story");
    await expect(page.getByRole("heading", { name: "An ordinary day" })).toBeVisible();

    await expect(page.getByText(ENGLISH[0])).toBeVisible();
    await expect(page.getByText(ENGLISH[1])).toBeVisible();
    await expect(page.getByText(ENGLISH[2])).toBeVisible();
  });

  test("falls back to the whole-story Arabic when there is no split", async ({ page, db }) => {
    await readWithScaffoldOn(page);
    db.seed("daily_vocab_stories", [aStory()]);

    await page.goto("/today/story");

    // No per-sentence scaffold, so the story-level Arabic appears below the
    // cards rather than being lost.
    await expect(page.getByText(ARABIC.join(" "))).toBeVisible();
  });

  test("keeps the story's own furniture around the reader", async ({ page, db }) => {
    db.seed("daily_vocab_stories", [aStory({ sentences: authoredSentences })]);

    await page.goto("/today/story");
    await expect(page.getByRole("heading", { name: "An ordinary day" })).toBeVisible();

    // The reader replaced the block of text, not the page around it.
    await expect(page.getByText("1 new word")).toBeVisible();
    await expect(page.getByRole("button", { name: /regenerate/i })).toBeVisible();
  });
});

test.describe("when there is no story yet", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("daily_vocab_stories", []);
  });

  test("generates one and reads it a sentence at a time", async ({ page, backend, db }) => {
    const story = aStory({ sentences: authoredSentences });
    // The real function writes the row and returns it; the page reads the row.
    backend.stubFunction("generate-daily-story", () => {
      db.seed("daily_vocab_stories", [story]);
      return { story };
    });

    await page.goto("/today/story");

    await expect(page.getByRole("heading", { name: "An ordinary day" })).toBeVisible();
    await expect(page.getByText(ENGLISH[1])).toBeVisible();
  });

  test("offers a retry rather than an empty reader when generation fails", async ({
    page,
    backend,
  }) => {
    backend.stubFunctionFailure("generate-daily-story");

    await page.goto("/today/story");

    await expect(page.getByRole("button", { name: /جرّب مرة ثانية/ })).toBeVisible();
    await expect(page.getByText(ENGLISH[0])).toHaveCount(0);
  });
});
