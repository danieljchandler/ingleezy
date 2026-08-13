import { expect, test, type Page } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";

/**
 * Today's Story — a ~200-word story built out of the learner's own deck.
 *
 * The thing worth pinning is the shape it is read in. A 200-word block of
 * dialect is the point at which a learner stops reading, so the story is
 * presented one sentence to a card, the way Souq News is: each line tappable
 * word by word, its English behind a tap of its own.
 *
 * Newer stories arrive with the split already authored. The ones already in the
 * table are four whole-paragraph columns, and the page splits those itself —
 * attaching a translation to a line only when the counts agree, since pairing
 * is by position and a confidently wrong translation is worse than none. Both
 * paths are covered here, because most stories in the wild are the second kind.
 */

const today = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

const ARABIC = [
  "الْبَيْت هَادِئ.",
  "رَاحَ عَلِي لِلشُّغُل.",
  "رِجَع بَعْد الْمَغْرِب.",
];
const ENGLISH = ["The house is quiet.", "Ali went to work.", "He came back after sunset."];

const aStory = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: TEST_USER_ID,
  story_date: today(),
  dialect: "Gulf",
  title: "يوم عادي",
  body_arabic: ARABIC.join(" "),
  body_transliteration: "al-bayt haadi'. raah 'ali lish-shughul. rija' ba'd al-maghrib.",
  body_english: ENGLISH.join(" "),
  body_english_literal: "the-house quiet. went Ali to-the-work. returned-he after the-sunset.",
  sentences: null,
  vocab_used: ["بيت"],
  new_words: ["شغل"],
  audio_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

const authoredSentences = ARABIC.map((arabic, i) => ({
  arabic,
  transliteration: ["al-bayt haadi'.", "raah 'ali lish-shughul.", "rija' ba'd al-maghrib."][i],
  english: ENGLISH[i],
  literal: ["the-house quiet.", "went Ali to-the-work.", "returned-he after the-sunset."][i],
}));

/** The learner's saved preference for seeing English, as Settings writes it. */
async function readWithEnglishOn(page: Page) {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      "hakiya:display-prefs",
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

  test("breaks the story into one card per sentence", async ({ page, db }) => {
    db.seed("daily_vocab_stories", [aStory({ sentences: authoredSentences })]);

    await page.goto("/today/story");
    await expect(page.getByRole("heading", { name: "يوم عادي" })).toBeVisible();

    // One reveal control per sentence is the visible proof the story is not a
    // single block of text — three sentences, three cards.
    await expect(page.getByRole("button", { name: "Reveal translation" })).toHaveCount(3);
    await expect(page.getByText(/Tap any word for translation/)).toBeVisible();
  });

  test("keeps each line's English behind its own tap", async ({ page, db }) => {
    db.seed("daily_vocab_stories", [aStory({ sentences: authoredSentences })]);

    await page.goto("/today/story");
    await page.getByRole("button", { name: "Reveal translation" }).first().click();

    await expect(page.getByText(ENGLISH[0])).toBeVisible();
    // Revealing all of them would be the story with a translation under it,
    // which is the block of text this replaced.
    await expect(page.getByRole("button", { name: "Reveal translation" })).toHaveCount(2);
  });

  test("shows the transliteration a line at a time", async ({ page, db }) => {
    db.seed("daily_vocab_stories", [aStory({ sentences: authoredSentences })]);

    await page.goto("/today/story");

    await expect(page.getByText("raah 'ali lish-shughul.")).toBeVisible();
    // The whole-story transliteration would be a second block under the first.
    await expect(
      page.getByText("al-bayt haadi'. raah 'ali lish-shughul. rija' ba'd al-maghrib."),
    ).toHaveCount(0);
  });

  test("splits a story that was stored as paragraphs", async ({ page, db }) => {
    // Every story generated before the split existed. The page splits the
    // Arabic itself and pairs the English by position.
    db.seed("daily_vocab_stories", [aStory()]);

    await page.goto("/today/story");
    await expect(page.getByRole("heading", { name: "يوم عادي" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Reveal translation" })).toHaveCount(3);
    await page.getByRole("button", { name: "Reveal translation" }).nth(1).click();
    await expect(page.getByText(ENGLISH[1])).toBeVisible();
  });

  test("falls back to the whole-story translation when the halves do not line up", async ({
    page,
    db,
  }) => {
    // One English sentence over three Arabic ones cannot be paired by position
    // without mislabelling two lines, so the page pairs none of them and offers
    // the story-level translation instead.
    await readWithEnglishOn(page);
    db.seed("daily_vocab_stories", [
      aStory({ body_english: "A quiet day, told in one breath.", body_english_literal: null }),
    ]);

    await page.goto("/today/story");
    await expect(page.getByRole("heading", { name: "يوم عادي" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Reveal translation" })).toHaveCount(0);
    await expect(page.getByText("A quiet day, told in one breath.")).toBeVisible();
  });

  test("opens every line for a learner who reads with English on", async ({ page, db }) => {
    await readWithEnglishOn(page);
    db.seed("daily_vocab_stories", [aStory({ sentences: authoredSentences })]);

    await page.goto("/today/story");

    await expect(page.getByRole("button", { name: "Hide translation" })).toHaveCount(3);
    await expect(page.getByText(ENGLISH[2])).toBeVisible();
  });

  test("keeps the story's own furniture around the reader", async ({ page, db }) => {
    db.seed("daily_vocab_stories", [aStory({ sentences: authoredSentences })]);

    await page.goto("/today/story");
    await expect(page.getByRole("heading", { name: "يوم عادي" })).toBeVisible();

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

    await expect(page.getByRole("heading", { name: "يوم عادي" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reveal translation" })).toHaveCount(3);
  });

  test("offers a retry rather than an empty reader when generation fails", async ({
    page,
    backend,
  }) => {
    backend.stubFunctionFailure("generate-daily-story");

    await page.goto("/today/story");

    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
    // Nothing was split, so nothing claims to be a story.
    await expect(page.getByText(/Tap any word for translation/)).toHaveCount(0);
  });
});
