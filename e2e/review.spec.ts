import { expect, test } from "./support/fixtures";
import {
  aTopic,
  aUserVocabulary,
  aVocabularyWord,
  aWordReview,
  daysAgo,
  many,
  reviewId,
  vocabId,
  wordId,
  TEST_USER_ID,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The review session — the app's core loop.
 *
 * The smoke suite already covered navigation between decks. What it could not
 * cover is what a rating actually *writes*, because the old double echoed an
 * empty array for every write. Since ratings are what the whole product exists
 * to record, and the scheduler is FSRS rather than something obvious, those are
 * the assertions worth having.
 *
 * Ratings do not go straight to the server: `useReviewQueue` puts them in
 * localStorage and flushes in the background, so the assertions poll rather
 * than expecting the write to have landed by the time the UI advanced.
 */

/** Seed `count` curriculum cards, all due yesterday. */
function seedCurriculum(db: MemoryDb, count: number) {
  db.seed("topics", [aTopic()]);
  db.seed(
    "vocabulary_words",
    many(aVocabularyWord, count, (index) => ({
      id: wordId(index),
      word_arabic: `كلمة${index + 1}`,
      word_english: `word ${index + 1}`,
      topic_id: aTopic().id as string,
    })),
  );
  db.seed(
    "word_reviews",
    many(aWordReview, count, (index) => ({
      id: reviewId(index),
      word_id: wordId(index),
      ease_factor: 5,
      interval_days: 3,
      repetitions: 2,
      lapses: 0,
      last_reviewed_at: daysAgo(3),
      next_review_at: daysAgo(1),
    })),
  );
}

type RatingLabel = "again" | "hard" | "good" | "easy";

/**
 * Reveal the answer, then rate.
 *
 * Each rating button renders its label followed by the interval that choice
 * would schedule ("Good 8d"), so the accessible name is matched by prefix
 * rather than exactly.
 */
async function rate(page: import("@playwright/test").Page, rating: RatingLabel) {
  await page.getByRole("button", { name: /show answer|reveal/i }).click();
  await page.getByRole("button", { name: new RegExp(`^${rating}\\b`, "i") }).click();
}

/** Wait for the background queue to flush the rating to the server. */
async function waitForWrite(db: MemoryDb, table: string, count = 1) {
  await expect
    .poll(() => db.writesTo(table).length, {
      message: `expected ${count} write(s) to ${table}; the review queue flushes in the background`,
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(count);
}

test.describe("rating a curriculum card", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedCurriculum(db, 3);
  });

  test("shows the first card and the whole session's progress", async ({ page }) => {
    await page.goto("/review");

    await expect(page.getByText("كلمة1")).toBeVisible();
    await expect(page.getByText(/Curriculum · 1 \/ 3 due/)).toBeVisible();
  });

  test("hides the answer until asked", async ({ page }) => {
    await page.goto("/review");

    await expect(page.getByText("word 1")).toHaveCount(0);
    await page.getByRole("button", { name: /show answer|reveal/i }).click();
    await expect(page.getByText("word 1")).toBeVisible();
  });

  test("a Good rating extends the interval and records the review", async ({ page, db }) => {
    await page.goto("/review");
    await rate(page, "good");

    await waitForWrite(db, "word_reviews");

    const write = db.lastWriteTo("word_reviews");
    const patch = write?.payload[0] ?? {};

    // Remembering it should push the card further out than the 3 days it was on.
    expect(Number(patch.interval_days)).toBeGreaterThan(3);
    expect(Number(patch.repetitions)).toBe(3);
    expect(Number(patch.lapses)).toBe(0);
    expect(new Date(String(patch.next_review_at)).getTime()).toBeGreaterThan(Date.now());
  });

  test("an Again rating collapses the interval and counts a lapse", async ({ page, db }) => {
    await page.goto("/review");
    await rate(page, "again");

    await waitForWrite(db, "word_reviews");

    const patch = db.lastWriteTo("word_reviews")?.payload[0] ?? {};

    // Forgetting resets the card to a short interval and increments lapses —
    // getting this wrong silently corrupts a learner's whole schedule.
    expect(Number(patch.interval_days)).toBeLessThan(3);
    expect(Number(patch.lapses)).toBe(1);

    // But repetitions is deliberately *not* reset: spacedRepetition.ts keeps it
    // above zero so a lapsed established card is not re-treated as brand new,
    // which would put it back through the new-card budget.
    expect(Number(patch.repetitions)).toBe(2);
  });

  test("Easy schedules further out than Good, which is further than Hard", async ({ page, db }) => {
    const intervalAfter = async (label: RatingLabel) => {
      db.resetJournals();
      await page.goto("/review");
      await rate(page, label);
      await waitForWrite(db, "word_reviews");
      return Number(db.lastWriteTo("word_reviews")?.payload[0]?.interval_days);
    };

    const hard = await intervalAfter("hard");
    const good = await intervalAfter("good");
    const easy = await intervalAfter("easy");

    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  test("advances to the next card without waiting on the network", async ({ page }) => {
    await page.goto("/review");
    await expect(page.getByText("كلمة1")).toBeVisible();

    await rate(page, "good");

    await expect(page.getByText("كلمة2")).toBeVisible();
    await expect(page.getByText(/Curriculum · 2 \/ 3 due/)).toBeVisible();
  });

  test("hides the answer again on the next card", async ({ page }) => {
    await page.goto("/review");
    await rate(page, "good");

    await expect(page.getByText("كلمة2")).toBeVisible();
    await expect(page.getByRole("button", { name: /show answer|reveal/i })).toBeVisible();
  });

  test("awards XP once the server has confirmed the rating", async ({ page, db }) => {
    await page.goto("/review");
    await rate(page, "good");

    await waitForWrite(db, "word_reviews");

    // XP is deliberately awarded on confirmed save, not on click.
    await expect
      .poll(() => Number(db.rows("user_xp")[0]?.total_xp ?? 0), { timeout: 10_000 })
      .toBeGreaterThan(250);
  });
});

test.describe("the offline queue", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedCurriculum(db, 1);
  });

  /**
   * The queue treats the two kinds of failure differently, and the distinction
   * is deliberate: a dropped connection is worth retrying with backoff, a
   * rejected request is not — retrying it forever would wedge the queue and
   * block every later rating behind it.
   */
  const NETWORK_FAILURE = {
    code: "503",
    // isNetworkError in useReviewQueue.ts classifies on the message, which is
    // how a real dropped fetch presents.
    message: "Failed to fetch",
    details: null,
    hint: null,
  };

  test("retries a save that failed because the connection dropped", async ({ page, db }) => {
    await page.goto("/review");

    // Fail the first save only. Writes only — failing the table outright would
    // also break the read that renders the card.
    db.failNextWrite("word_reviews", 503, NETWORK_FAILURE);
    await rate(page, "good");

    // Backoff starts at 1s, so give the retry room to land.
    await expect
      .poll(() => db.writesTo("word_reviews").length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);
  });

  test("holds the rating in localStorage while the connection is down", async ({ page, db }) => {
    await page.goto("/review");

    db.failWrites("word_reviews", 503, NETWORK_FAILURE);
    await rate(page, "good");

    // The queue is persisted precisely so a reload or a crash cannot drop a
    // rating the learner has already given.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(window.localStorage).some((key) => key.includes("review")),
        ),
      )
      .toBe(true);
  });

  test("tells the learner when a rating is rejected outright, rather than losing it silently", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    // A server error is not retried — it is dropped. The toast is the only
    // thing standing between that and a rating vanishing without trace.
    expectConsoleErrors([/Review submit failed permanently/]);

    await page.goto("/review");
    db.failWrites("word_reviews", 400, {
      code: "23514",
      message: "violates check constraint",
      details: null,
      hint: null,
    });

    await rate(page, "good");

    await expect(page.getByText(/couldn't be saved/i)).toBeVisible();
  });
});

test.describe("saved-word decks", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("rates a saved word into its own table, not the curriculum one", async ({ page, db }) => {
    db.seed(
      "user_vocabulary",
      many(aUserVocabulary, 2, (index) => ({
        id: vocabId(index),
        user_id: TEST_USER_ID,
        word_arabic: `محفوظ${index + 1}`,
        word_english: `saved ${index + 1}`,
      })),
    );

    await page.goto("/review/my-words");
    await expect(page.getByText("محفوظ1")).toBeVisible();

    await rate(page, "good");
    await waitForWrite(db, "user_vocabulary");

    // The two decks share a scheduler but not a table; writing a saved-word
    // rating into word_reviews would silently corrupt the curriculum deck.
    expect(db.writesTo("word_reviews")).toHaveLength(0);

    // The *scheduling* write, not the last one, and polled rather than read
    // once. Audio persistence patches the same table with `word_audio_url` and
    // races the rating, so `lastWriteTo` picks up whichever landed second —
    // sometimes the audio one, sometimes before the rating has gone out at all.
    await expect
      .poll(() =>
        db
          .writesTo("user_vocabulary")
          .some((write) => "next_review_at" in (write.payload[0] ?? {})),
      )
      .toBe(true);
  });

  /**
   * The root footnote under a revealed card.
   *
   * This is the scenario the feature exists for and the one that silently
   * failed before: two cards from one root, saved by different paths and so
   * carrying different spellings of it. Matching on the stored string made them
   * strangers; matching on a canonical key makes them a family.
   */
  test("shows the words you know from the card's root, however each was spelled", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({
        id: vocabId(0),
        user_id: TEST_USER_ID,
        word_arabic: "كتاب",
        word_english: "book",
        root: "ك-ت-ب",
      }),
      aUserVocabulary({
        id: vocabId(1),
        user_id: TEST_USER_ID,
        word_arabic: "مكتبة",
        word_english: "library",
        root: "ك ت ب",
        next_review_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ]);

    await page.goto("/review/my-words");
    await expect(page.getByText("كتاب")).toBeVisible();

    // Nothing before the learner has committed to an answer.
    await expect(page.getByText(/shares this root/i)).toHaveCount(0);

    await page.getByRole("button", { name: /show answer|reveal/i }).click();

    const footnote = page.getByRole("button", { name: /1 word you know shares this root/i });
    await expect(footnote).toBeVisible();
    // Collapsed until asked: the learner is mid-recall.
    await expect(footnote).toHaveAttribute("aria-expanded", "false");

    await footnote.click();
    await expect(page.getByText("library")).toBeVisible();
  });

  test("says nothing about roots when the learner has turned them off", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_arabic: "كتاب", root: "ك ت ب" }),
      aUserVocabulary({
        id: vocabId(1),
        user_id: TEST_USER_ID,
        word_arabic: "مكتبة",
        root: "ك ت ب",
        next_review_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ]);

    await page.addInitScript(() => {
      window.localStorage.setItem("hakiya:root-families-enabled", "false");
    });

    await page.goto("/review/my-words");
    await page.getByRole("button", { name: /show answer|reveal/i }).click();

    await expect(page.getByText(/shares this root/i)).toHaveCount(0);
  });

  test("reports the deck finished when nothing is due", async ({ page, db }) => {
    db.seed("user_vocabulary", []);
    await page.goto("/review/my-words");

    await expect(page.getByRole("heading", { name: /all caught up|deck complete/i })).toBeVisible();
  });

  /**
   * The "Mixed" toggle on the home screen counts saved words across every
   * dialect, but this deck reads the globally active one — so the link now
   * carries `?mixed=1` and the deck drops its dialect filter when it sees it.
   *
   * Both halves are asserted: without the flag the deck must still scope to the
   * active dialect, or the toggle would be the only way to get a scoped session.
   */
  function seedTwoDialects(db: MemoryDb) {
    db.seed("user_vocabulary", [
      aUserVocabulary({
        id: vocabId(0),
        word_arabic: "خليجي",
        word_english: "gulf word",
        dialect: "Gulf",
        next_review_at: daysAgo(2),
      }),
      aUserVocabulary({
        id: vocabId(1),
        word_arabic: "مصري",
        word_english: "egyptian word",
        dialect: "Egyptian",
        next_review_at: daysAgo(1),
      }),
    ]);
  }

  test("?mixed=1 opens a session across every dialect", async ({ page, db }) => {
    seedTwoDialects(db);

    await page.goto("/review/my-words?mixed=1");

    await expect(page.getByText(/1 \/ 2 due/)).toBeVisible();
    await expect(page.getByText("خليجي")).toBeVisible();

    await rate(page, "good");

    // The second dialect's word is in the same session rather than behind a
    // dialect switch — which is what the "3 due" count promised.
    await expect(page.getByText("مصري")).toBeVisible();
  });

  test("without the flag the deck still holds one dialect", async ({ page, db }) => {
    seedTwoDialects(db);

    await page.goto("/review/my-words");

    await expect(page.getByText(/1 \/ 1 due/)).toBeVisible();
    await expect(page.getByText("خليجي")).toBeVisible();
    await expect(page.getByText("مصري")).toHaveCount(0);
  });
});

test.describe("when the deck cannot load", () => {
  test("shows an error rather than an empty deck", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedCurriculum(db, 2);
    db.failAlways("word_reviews", 500);

    await page.goto("/review");

    // A failed query that renders as "nothing due" tells the learner they are
    // finished when they are not.
    await expect(page.getByText(/all caught up|nothing due/i)).toHaveCount(0);
  });
});
