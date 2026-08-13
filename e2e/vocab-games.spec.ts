import { expect, test } from "./support/fixtures";
import {
  aUserVocabulary,
  aVocabGameSet,
  aVocabularyWord,
  gameSetId,
  many,
  wordId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * The vocabulary games: three ways to drill the same six word pairs.
 *
 * The word list is what makes this worth testing. It comes from one of three
 * places in strict order — a published game set, the learner's saved words, or
 * the curriculum — and each source is only used if it yields at least six
 * pairs. A fallback that fires when it shouldn't means a learner drilling words
 * they never chose; one that fails to fire means a dead menu.
 *
 * Everything is shuffled, so tests read the words off the page rather than
 * assuming an order.
 */

const PAIRS = [
  { arabic: "باب", english: "door" },
  { arabic: "كتاب", english: "book" },
  { arabic: "كرسي", english: "chair" },
  { arabic: "طاولة", english: "table" },
  { arabic: "نافذة", english: "window" },
  { arabic: "مفتاح", english: "key" },
];

const matchingCard = (page: Page) => page.getByText("Word Matching");
const arabicColumn = (page: Page) => page.locator("div.grid-cols-2 > div").first();
const englishColumn = (page: Page) => page.locator("div.grid-cols-2 > div").nth(1);

/** Nothing anywhere — the empty state. */
function seedNothing(db: MemoryDb) {
  db.seed("vocab_game_sets", []);
  db.seed("user_vocabulary", []);
  db.seed("vocabulary_words", []);
}

function seedCurriculum(db: MemoryDb, count = 6) {
  db.seed(
    "vocabulary_words",
    many(aVocabularyWord, count, (i) => ({
      id: wordId(i),
      word_arabic: PAIRS[i % PAIRS.length].arabic,
      word_english: PAIRS[i % PAIRS.length].english,
      topic_id: null,
      lesson_id: null,
    })),
  );
}

/**
 * Play the matching game to completion.
 *
 * Both columns are shuffled independently, so the pairing is read off the page:
 * tap an Arabic word, then find the English button whose text is its partner.
 */
async function playMatching(page: Page, pairs = PAIRS) {
  for (const pair of pairs) {
    await arabicColumn(page).getByRole("button", { name: pair.arabic }).click();
    await englishColumn(page).getByRole("button", { name: pair.english }).click();
  }
}

test.describe("choosing a game", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedNothing(db);
  });

  test("offers all three games once there are words", async ({ page, db }) => {
    seedCurriculum(db);

    await page.goto("/vocab-games");

    await expect(page.getByRole("heading", { name: /Vocabulary Games/ })).toBeVisible();
    await expect(page.getByText("Word Matching")).toBeVisible();
    await expect(page.getByText("Memory Cards")).toBeVisible();
    await expect(page.getByText("Fill in the Blank")).toBeVisible();
  });

  test("describes what each game does", async ({ page, db }) => {
    seedCurriculum(db);

    await page.goto("/vocab-games");

    await expect(page.getByText("Connect Arabic words to their English meanings")).toBeVisible();
    await expect(page.getByText("Flip and find matching Arabic-English pairs")).toBeVisible();
  });

  test("sends a learner with too few words to go and learn some", async ({ page, db }) => {
    seedCurriculum(db, 5);

    await page.goto("/vocab-games");

    // Six is the smallest board any of the three games can lay out; offering a
    // game that cannot start is worse than saying why.
    await expect(page.getByText("Need at least 6 words to play")).toBeVisible();
    await expect(page.getByText("Word Matching")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start Learning" })).toBeVisible();
  });

  test("says the same with no words at all", async ({ page }) => {
    await page.goto("/vocab-games");

    await expect(page.getByText("Need at least 6 words to play")).toBeVisible();
  });
});

test.describe("where the words come from", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedNothing(db);
  });

  test("prefers a published game set", async ({ page, db }) => {
    db.seed("vocab_game_sets", [aVocabGameSet({ id: gameSetId(0) })]);
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: "voc-0", word_arabic: "مطبخ", word_english: "kitchen" }),
    ]);
    seedCurriculum(db);

    await page.goto("/vocab-games");
    await matchingCard(page).click();

    // Curated pairs are known to be a sensible set; a random slice of the
    // learner's deck may be six words that never co-occur.
    await expect(arabicColumn(page).getByRole("button", { name: "باب" })).toBeVisible();
    await expect(page.getByText("مطبخ")).toHaveCount(0);
  });

  test("skips a game set that is too small to lay out", async ({ page, db }) => {
    db.seed("vocab_game_sets", [
      aVocabGameSet({
        word_pairs: [
          { word_arabic: "باب", word_english: "door" },
          { word_arabic: "كتاب", word_english: "book" },
        ],
      }),
    ]);
    db.seed("user_vocabulary", many(aUserVocabulary, 6, (i) => ({
      id: `voc-${i}`,
      word_arabic: `كلمة${i}`,
      word_english: `word ${i}`,
    })));

    await page.goto("/vocab-games");
    await matchingCard(page).click();

    // A two-pair set is not an error, it is just not enough — fall through
    // rather than showing a half-empty board.
    await expect(arabicColumn(page).getByRole("button", { name: "كلمة0" })).toBeVisible();
  });

  test("skips an unpublished game set", async ({ page, db }) => {
    db.seed("vocab_game_sets", [aVocabGameSet({ status: "draft" })]);
    seedCurriculum(db);

    await page.goto("/vocab-games");

    await expect(page.getByText("Word Matching")).toBeVisible();
  });

  test("uses the learner's own words before the curriculum", async ({ page, db }) => {
    db.seed("user_vocabulary", many(aUserVocabulary, 6, (i) => ({
      id: `voc-${i}`,
      word_arabic: `محفوظ${i}`,
      word_english: `saved ${i}`,
    })));
    seedCurriculum(db);

    await page.goto("/vocab-games");
    await matchingCard(page).click();

    // Words the learner chose to save are the ones they are trying to learn.
    await expect(arabicColumn(page).getByRole("button", { name: "محفوظ0" })).toBeVisible();
  });

  test("falls back to the curriculum for a learner with a thin deck", async ({ page, db }) => {
    db.seed("user_vocabulary", many(aUserVocabulary, 3, (i) => ({
      id: `voc-${i}`,
      word_arabic: `محفوظ${i}`,
      word_english: `saved ${i}`,
    })));
    seedCurriculum(db);

    await page.goto("/vocab-games");
    await matchingCard(page).click();

    // Three saved words cannot fill a board, and padding them with curriculum
    // words is not what the code does — it discards them entirely.
    await expect(arabicColumn(page).getByRole("button", { name: "محفوظ0" })).toHaveCount(0);
    await expect(arabicColumn(page).getByRole("button", { name: PAIRS[0].arabic })).toBeVisible();
  });

  test("uses the curriculum for a signed-out visitor", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    seedNothing(db);
    seedCurriculum(db);

    await page.goto("/vocab-games");

    // No account, no saved deck — but the games are still playable.
    await expect(page.getByText("Word Matching")).toBeVisible();
  });
});

test.describe("word matching", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedNothing(db);
    db.seed("vocab_game_sets", [aVocabGameSet({ id: gameSetId(0) })]);
  });

  test("lays out both columns", async ({ page }) => {
    await page.goto("/vocab-games");
    await matchingCard(page).click();

    await expect(page.getByRole("heading", { name: "Match the Pairs" })).toBeVisible();
    await expect(page.getByText("Tap an Arabic word, then its English match")).toBeVisible();
    await expect(arabicColumn(page).getByRole("button")).toHaveCount(6);
    await expect(englishColumn(page).getByRole("button")).toHaveCount(6);
  });

  test("counts down as pairs are matched", async ({ page }) => {
    await page.goto("/vocab-games");
    await matchingCard(page).click();

    await expect(page.getByText("0/6 matched", { exact: false })).toBeVisible();
    await arabicColumn(page).getByRole("button", { name: "باب" }).click();
    await englishColumn(page).getByRole("button", { name: "door" }).click();
    await expect(page.getByText("1/6 matched", { exact: false })).toBeVisible();
  });

  test("takes a wrong pairing without matching it", async ({ page }) => {
    await page.goto("/vocab-games");
    await matchingCard(page).click();

    await arabicColumn(page).getByRole("button", { name: "باب" }).click();
    await englishColumn(page).getByRole("button", { name: "book" }).click();

    await expect(page.getByText("0/6 matched", { exact: false })).toBeVisible();
    await expect(page.getByText("1 mistakes", { exact: false })).toBeVisible();
  });

  test("takes no English tap until an Arabic word is chosen", async ({ page }) => {
    await page.goto("/vocab-games");
    await matchingCard(page).click();

    // Disabled rather than ignored — tapping answers in isolation would let a
    // learner brute force the board without reading the Arabic at all, and a
    // silently dead button reads as a broken one.
    await expect(englishColumn(page).getByRole("button", { name: "door" })).toBeDisabled();
    await arabicColumn(page).getByRole("button", { name: "باب" }).click();
    await expect(englishColumn(page).getByRole("button", { name: "door" })).toBeEnabled();
  });

  test("scores a clean run at full marks", async ({ page }) => {
    await page.goto("/vocab-games");
    await matchingCard(page).click();
    await playMatching(page);

    await expect(page.getByRole("heading", { name: "Word Matching Complete!" })).toBeVisible();
    await expect(page.getByText("6 / 6 correct")).toBeVisible();
    await expect(page.getByText("100%")).toBeVisible();
  });

  test("docks a point for each wrong pairing", async ({ page }) => {
    await page.goto("/vocab-games");
    await matchingCard(page).click();

    await arabicColumn(page).getByRole("button", { name: "باب" }).click();
    await englishColumn(page).getByRole("button", { name: "book" }).click();
    // A wrong pairing shakes for 600ms and then clears the selection. Playing
    // on before that lands would have the pending timeout deselect mid-move.
    await expect(englishColumn(page).getByRole("button", { name: "book" })).toBeDisabled();
    await playMatching(page);

    // Six pairs found, one mistake made — the score is the board minus the
    // errors, not the pairs found.
    await expect(page.getByText("5 / 6 correct")).toBeVisible();
  });

  test("offers another go and a way back", async ({ page }) => {
    await page.goto("/vocab-games");
    await matchingCard(page).click();
    await playMatching(page);

    await expect(page.getByRole("button", { name: "Play Again" })).toBeVisible();
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByText("Memory Cards")).toBeVisible();
  });
});

test.describe("fill in the blank", () => {
  test.beforeEach(async ({ signInAs, db, page }) => {
    await signInAs("free");
    seedNothing(db);
    db.seed("vocab_game_sets", [aVocabGameSet({ id: gameSetId(0) })]);
    await page.goto("/vocab-games");
    await page.getByText("Fill in the Blank").click();
  });

  test("asks for the English of one word at a time", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Fill in the Blank" })).toBeVisible();
    await expect(page.getByText("What does this mean?")).toBeVisible();
    await expect(page.getByPlaceholder("Type the English meaning...")).toBeVisible();
  });

  test("will not check an empty answer", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Check" })).toBeDisabled();
  });

  test("accepts an answer in any case", async ({ page }) => {
    const arabic = await page.locator('p[dir="rtl"]').first().innerText();
    const english = PAIRS.find((p) => p.arabic === arabic)!.english;

    await page.getByPlaceholder("Type the English meaning...").fill(english.toUpperCase());
    await page.getByRole("button", { name: "Check" }).click();

    // Nobody types "Door" meaning something different from "door"; a
    // case-sensitive check would just be a typing test.
    await expect(page.getByText(/Correct/i)).toBeVisible();
  });

  test("ignores surrounding whitespace", async ({ page }) => {
    const arabic = await page.locator('p[dir="rtl"]').first().innerText();
    const english = PAIRS.find((p) => p.arabic === arabic)!.english;

    await page.getByPlaceholder("Type the English meaning...").fill(`  ${english}  `);
    await page.getByRole("button", { name: "Check" }).click();

    await expect(page.getByText(/Correct/i)).toBeVisible();
  });

  test("shows the answer after a wrong guess", async ({ page }) => {
    const arabic = await page.locator('p[dir="rtl"]').first().innerText();
    const english = PAIRS.find((p) => p.arabic === arabic)!.english;

    await page.getByPlaceholder("Type the English meaning...").fill("something else");
    await page.getByRole("button", { name: "Check" }).click();

    await expect(page.getByText(english, { exact: false }).first()).toBeVisible();
  });

  test("plays through every word and reports the score", async ({ page }) => {
    for (let i = 0; i < 6; i++) {
      const arabic = await page.locator('p[dir="rtl"]').first().innerText();
      const english = PAIRS.find((p) => p.arabic === arabic)!.english;
      await page.getByPlaceholder("Type the English meaning...").fill(english);
      await page.getByRole("button", { name: "Check" }).click();
      await page.getByRole("button", { name: /Next|Finish|See Results/ }).click();
    }

    await expect(page.getByRole("heading", { name: "Fill in the Blank Complete!" })).toBeVisible();
    await expect(page.getByText("6 / 6 correct")).toBeVisible();
  });
});

test.describe("memory cards", () => {
  test.beforeEach(async ({ signInAs, db, page }) => {
    await signInAs("free");
    seedNothing(db);
    db.seed("vocab_game_sets", [aVocabGameSet({ id: gameSetId(0) })]);
    await page.goto("/vocab-games");
    await page.getByText("Memory Cards").click();
  });

  test("deals a card per side of every pair", async ({ page }) => {
    // Six pairs means twelve cards; a board with an odd count has an
    // unmatchable card on it.
    await expect(page.getByRole("heading", { name: "Memory Cards" })).toBeVisible();
    await expect(page.locator("div.grid-cols-3 > button")).toHaveCount(12);
  });

  test("goes back to the menu without finishing", async ({ page }) => {
    await page.getByRole("button", { name: "Back" }).click();

    await expect(page.getByText("Word Matching")).toBeVisible();
  });
});
