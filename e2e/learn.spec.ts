import { expect, test, type Page } from "./support/fixtures";
import {
  aLesson,
  aLessonProgress,
  aStage,
  aVocabularyWord,
  aWordReview,
  daysAgo,
  lessonId,
  many,
  reviewId,
  stageId,
  wordId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The lesson runner and the standalone quiz.
 *
 * `/learn/:id` alternates an intro card with a quiz card for each word, records
 * an SRS review per answer, and saves how far through the learner got. The
 * resume logic is the delicate part: `hasResumed` gates the progress write so
 * that mounting at index 0 cannot overwrite a saved position before the restore
 * runs. Getting that wrong loses a learner's place silently, which is why the
 * specs drive a real partial session and then revisit.
 *
 * The intro card is production-first by design — it shows the English and hides
 * the Arabic behind "Show Arabic", so the learner tries to produce it before
 * seeing it. Cards are therefore located by their English text and by the
 * progress counter, not by the Arabic.
 *
 * Answers are asserted against `word_reviews` because a lesson answer is also a
 * scheduling decision: a wrong word id there corrupts the review deck.
 */

const LESSON = lessonId(0);

/** A lesson with `count` words, plus the stage it belongs to. */
function seedLesson(db: MemoryDb, count = 4, over: Record<string, unknown> = {}) {
  db.seed("curriculum_stages", [aStage({ id: stageId(0) })]);
  db.seed("lessons", [aLesson({ id: LESSON, stage_id: stageId(0), ...over })]);
  db.seed(
    "vocabulary_words",
    many(aVocabularyWord, count, (index) => ({
      id: wordId(index),
      lesson_id: LESSON,
      topic_id: null,
      word_arabic: `كلمة${index + 1}`,
      word_english: `word ${index + 1}`,
      display_order: index,
    })),
  );
  db.seed("word_reviews", []);
  db.seed("lesson_progress", []);
}

/** The "N / total" counter under the card. */
const atCard = (page: Page, index: number, total: number) =>
  expect(page.getByText(`${index + 1} / ${total}`)).toBeVisible();

/**
 * Move to the quiz for the current card and pick `english`.
 *
 * The options are `role="radio"`, not buttons — QuizCard wraps them in a
 * radiogroup so a screen reader announces them as one choice rather than four
 * unrelated actions.
 */
async function answer(page: Page, english: string) {
  await page.getByRole("button", { name: "كمّل للاختبار" }).click();
  await page.getByRole("radio", { name: english, exact: true }).click();
}

/** Answer the card at `index` correctly. */
const answerCorrectly = (page: Page, index: number) => answer(page, `word ${index + 1}`);

/**
 * The first rating of a never-seen word throws, and the throw is visible.
 *
 * `submitRatingToServer` inserts the review row, then calls
 * `supabase.rpc(...).catch(() => {})` to claim daily new-card budget. A
 * PostgrestFilterBuilder is a thenable, not a Promise — it implements `then`
 * and nothing else — so `.catch` is undefined and the call throws a TypeError
 * synchronously, before the function returns. The comment above it says
 * "best-effort — never blocks the review submission"; it blocks it every time.
 *
 * The row still lands, because the insert is awaited first. What is lost is
 * everything downstream of the mutation succeeding: XP, the review counter, the
 * achievement check, and the new-card budget the RPC existed to claim.
 *
 * Only new cards are affected, which is why the review suite never saw it —
 * those fixtures all seed an existing row and take the update path.
 */
const NEW_CARD_RPC_BUG = [
  /supabase\.rpc\(\.\.\.\)\.catch is not a function/,
  /Failed to submit review/,
];

/** Miss the current card, then acknowledge the correction. */
async function answerWrongly(page: Page, wrongEnglish: string) {
  await answer(page, wrongEnglish);
  await page.getByRole("button", { name: /^continue$/i }).click();
}

test.describe("working through a lesson", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 4);
  });

  test("opens on the first word in its authored order", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);

    await expect(page.getByText("word 1", { exact: true })).toBeVisible();
    await atCard(page, 0, 4);
  });

  test("keeps the Arabic hidden until the learner asks for it", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);
    await expect(page.getByText(/جرّب تقول معناها/)).toBeVisible();

    // Production-first: showing the Arabic straight away turns a recall attempt
    // into a reading exercise.
    await expect(page.getByText("كلمة1")).toHaveCount(0);
    await page.getByRole("button", { name: "ورّني العربي" }).click();
    await expect(page.getByText("كلمة1")).toBeVisible();
  });

  test("shows the word's root once the Arabic is revealed, and not before", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({
        id: wordId(0),
        lesson_id: LESSON,
        topic_id: null,
        word_arabic: "كتاب",
        word_english: "book",
        display_order: 0,
        // Stored with hyphens, as one of the AI paths writes it — the display
        // canonicalises whatever spelling reached the column.
        root: "ك-ت-ب",
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    // The root is a strong clue to the meaning, and the learner is being asked
    // to produce the word from the picture.
    await expect(page.getByText("ك · ت · ب")).toHaveCount(0);

    await page.getByRole("button", { name: "ورّني العربي" }).click();

    await expect(page.getByText("ك · ت · ب")).toBeVisible();
  });

  test("shows no root chip for a word that has none", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({
        id: wordId(0),
        lesson_id: LESSON,
        topic_id: null,
        word_arabic: "كمبيوتر",
        word_english: "computer",
        display_order: 0,
        root: null,
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    await page.getByRole("button", { name: "ورّني العربي" }).click();

    // Most curriculum words have no root until an admin backfills them, so an
    // empty chip would be the normal case rather than the exception.
    await expect(page.getByTitle("الجذر العربي")).toHaveCount(0);
  });

  test("asks for the English once the quiz starts", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);
    await page.getByRole("button", { name: "كمّل للاختبار" }).click();

    await expect(page.getByText(/وش معناها بالإنجليزي/)).toBeVisible();
    await expect(page.getByRole("radiogroup")).toBeVisible();
    // The Arabic is the prompt now, so it is shown whether or not it was
    // revealed on the intro card.
    await expect(page.getByText("كلمة1")).toBeVisible();
  });

  test("advances to the next word after a correct answer", async ({ page, expectConsoleErrors }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    await page.goto(`/learn/${LESSON}`);
    await answerCorrectly(page, 0);

    await expect(page.getByText("word 2", { exact: true })).toBeVisible();
    await atCard(page, 1, 4);
  });

  test("waits for the learner to read the right answer after a miss", async ({ page }) => {
    await page.goto(`/learn/${LESSON}`);
    await answer(page, "word 2");

    // A wrong answer does not auto-advance; it holds until Continue is tapped,
    // so the correct option is actually read rather than flashing past.
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeVisible();
    await atCard(page, 0, 4);
  });

  test("finishes with a score once every word is answered", async ({ page, expectConsoleErrors }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    await page.goto(`/learn/${LESSON}`);
    for (let index = 0; index < 4; index++) await answerCorrectly(page, index);

    await expect(page.getByRole("heading", { name: /ممتاز!/ })).toBeVisible();
    await expect(page.getByText("100%")).toBeVisible();
    await expect(page.getByText("4 / 4 correct")).toBeVisible();
  });

  test("scores a mixed session honestly", async ({ page, expectConsoleErrors }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    await page.goto(`/learn/${LESSON}`);

    await answerWrongly(page, "word 2");
    for (let index = 1; index < 4; index++) await answerCorrectly(page, index);

    await expect(page.getByText("75%")).toBeVisible();
    await expect(page.getByRole("heading", { name: /مجهود طيب/ })).toBeVisible();
  });

  test("restarting clears the score rather than adding to it", async ({ page, expectConsoleErrors }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    await page.goto(`/learn/${LESSON}`);
    for (let index = 0; index < 4; index++) await answerCorrectly(page, index);
    await expect(page.getByText("100%")).toBeVisible();

    await page.getByRole("button", { name: /تمرّن مرة ثانية|تعلّم كلمات أكثر/ }).click();

    await expect(page.getByText("word 1", { exact: true })).toBeVisible();
    await atCard(page, 0, 4);
  });
});

test.describe("what a lesson answer records", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 4);
  });

  test("schedules the word that was actually asked", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    await page.goto(`/learn/${LESSON}`);
    await answerCorrectly(page, 0);
    await atCard(page, 1, 4);

    await expect.poll(() => db.rows("word_reviews").length, { timeout: 10_000 }).toBe(1);

    // The review is a scheduling decision for one specific card; the wrong id
    // here silently reschedules a word the learner never saw.
    const review = db.rows("word_reviews")[0];
    expect(review.word_id).toBe(wordId(0));
    expect(new Date(String(review.next_review_at)).getTime()).toBeGreaterThan(Date.now());
  });

  test("a miss brings the word back soon rather than being dropped", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    await page.goto(`/learn/${LESSON}`);
    await answerWrongly(page, "word 2");
    await atCard(page, 1, 4);

    await expect.poll(() => db.rows("word_reviews").length, { timeout: 10_000 }).toBe(1);

    const review = db.rows("word_reviews")[0];
    expect(review.word_id).toBe(wordId(0));
    // Forgetting has to shorten the interval. Recording the miss as a pass
    // would push the word out of sight for weeks.
    expect(Number(review.interval_days)).toBeLessThanOrEqual(1);
  });

  test("builds on an existing review rather than starting the card over", async ({ page, db }) => {
    db.seed("word_reviews", [
      aWordReview({
        id: reviewId(0),
        word_id: wordId(0),
        repetitions: 4,
        interval_days: 20,
        next_review_at: daysAgo(1),
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    await answerCorrectly(page, 0);
    await atCard(page, 1, 4);

    await expect
      .poll(() => Number(db.rows("word_reviews")[0]?.repetitions), { timeout: 10_000 })
      .toBe(5);
    // Still one row: a second would give the card two competing schedules.
    expect(db.rows("word_reviews")).toHaveLength(1);
  });

  test("awards no XP for a new card, because the submission throws first", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    await page.goto(`/learn/${LESSON}`);
    await answerCorrectly(page, 0);
    await expect.poll(() => db.rows("word_reviews").length, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1000);

    // The visible consequence of the bug above: the card is scheduled, but the
    // mutation rejects, so onSuccess never runs and the learner is paid nothing
    // for a word they just learned. Rating an already-seen card does award XP —
    // see "builds on an existing review" — which is what makes this so easy to
    // miss by hand.
    expect(Number(db.rows("user_xp")[0]?.total_xp ?? 0)).toBe(250);
  });

  test("awards XP for a card that already has a review row", async ({ page, db }) => {
    db.seed("word_reviews", [
      aWordReview({ id: reviewId(0), word_id: wordId(0), next_review_at: daysAgo(1) }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    await answerCorrectly(page, 0);

    await expect
      .poll(() => Number(db.rows("user_xp")[0]?.total_xp ?? 0), { timeout: 10_000 })
      .toBeGreaterThan(250);
  });

  test("a signed-out visitor can still take the lesson", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    seedLesson(db, 4);

    await page.goto(`/learn/${LESSON}`);
    await answerCorrectly(page, 0);

    await atCard(page, 1, 4);
    // Nothing to schedule against, so nothing is written — but the lesson works.
    expect(db.rows("word_reviews")).toHaveLength(0);
  });

  test("invites a signed-out visitor to sign in at the end", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    seedLesson(db, 4);

    await page.goto(`/learn/${LESSON}`);
    for (let index = 0; index < 4; index++) await answerCorrectly(page, index);

    await expect(page.getByRole("link", { name: /login/i })).toBeVisible();
  });
});

test.describe("picking up where the learner left off", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 4);
  });

  test("saves how far through the lesson got", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    await page.goto(`/learn/${LESSON}`);
    await answerCorrectly(page, 0);
    await atCard(page, 1, 4);

    await expect.poll(() => db.rows("lesson_progress").length, { timeout: 10_000 }).toBe(1);

    const progress = db.rows("lesson_progress")[0];
    expect(progress.lesson_id).toBe(LESSON);
    expect(Number(progress.last_word_index)).toBe(1);
    expect(Number(progress.words_total)).toBe(4);
  });

  test("resumes at the saved word on the next visit", async ({ page, db }) => {
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "in_progress",
        last_word_index: 2,
        words_seen: 3,
        words_total: 4,
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);

    // The whole point of the server-side row: a learner who switches device
    // continues rather than restarting.
    await expect(page.getByText("word 3", { exact: true })).toBeVisible();
    await atCard(page, 2, 4);
  });

  test("does not overwrite the saved position before restoring it", async ({ page, db }) => {
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "in_progress",
        last_word_index: 2,
        words_total: 4,
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    await atCard(page, 2, 4);

    // Mounting starts at index 0; a write before the restore ran would persist 0
    // and destroy the position it was about to jump to.
    expect(Number(db.rows("lesson_progress")[0].last_word_index)).toBeGreaterThanOrEqual(2);
  });

  test("starts a completed lesson from the top", async ({ page, db }) => {
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "completed",
        last_word_index: 3,
        words_total: 4,
        best_score: 100,
        completed_at: daysAgo(1),
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);

    // Re-opening a finished lesson is a decision to practise it again, so
    // resuming at the last card would hand the learner a single word.
    await atCard(page, 0, 4);
  });

  test("marks the lesson completed with its score", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    await page.goto(`/learn/${LESSON}`);
    for (let index = 0; index < 4; index++) await answerCorrectly(page, index);
    await expect(page.getByText("100%")).toBeVisible();

    await expect
      .poll(() => db.rows("lesson_progress")[0]?.status, { timeout: 10_000 })
      .toBe("completed");
    expect(Number(db.rows("lesson_progress")[0].best_score)).toBe(100);
  });

  test("keeps the better of two scores", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors(NEW_CARD_RPC_BUG);

    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "completed",
        last_word_index: 3,
        words_total: 4,
        best_score: 100,
        completed_at: daysAgo(2),
      }),
    ]);

    await page.goto(`/learn/${LESSON}`);
    await answerWrongly(page, "word 2");
    for (let index = 1; index < 4; index++) await answerCorrectly(page, index);
    await expect(page.getByText("75%")).toBeVisible();

    // "Best score" has to mean best; overwriting it turns practice into a way
    // of losing a record already earned.
    await expect
      .poll(() => Number(db.rows("lesson_progress")[0]?.best_score), { timeout: 10_000 })
      .toBe(100);
  });
});

test.describe("when the lesson cannot be shown", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("says so for an id that matches nothing", async ({ page, db }) => {
    db.seed("lessons", []);
    db.seed("topics", []);
    db.seed("vocabulary_words", []);

    await page.goto(`/learn/${lessonId(9)}`);
    await expect(page.getByText(/ما لقينا الموضوع/)).toBeVisible();
  });

  test("says so for a lesson with no words yet", async ({ page, db }) => {
    seedLesson(db, 0);

    await page.goto(`/learn/${LESSON}`);
    await expect(page.getByText(/ما فيه كلمات بعد/)).toBeVisible();
  });

  test("does not render an empty lesson when the query failed", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedLesson(db, 4);
    db.failAlways("vocabulary_words", 500);

    await page.goto(`/learn/${LESSON}`);

    // "No words yet" after a failed request tells the learner the lesson is
    // empty when it is not.
    await expect(page.getByText(/ما فيه كلمات بعد/)).toHaveCount(0);
  });
});

test.describe("the standalone quiz", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 5);
  });

  test("crashes on any lesson it could actually quiz", async ({ page, expectConsoleErrors }) => {
    expectConsoleErrors([/Cannot read properties of undefined/, /ErrorBoundary caught error/]);

    await page.goto(`/quiz/${LESSON}`);

    // A real bug, recorded rather than fixed here. Quiz.tsx shuffles the words
    // in a useEffect, so on the render where the query resolves `shuffledWords`
    // is still empty — `key={currentWord.id}` then dereferences undefined and
    // the route renders the error boundary. It reproduces for every lesson with
    // four or more words, which is every lesson the page will run at all; with
    // fewer it returns "Need more words" before reaching the crash, which is
    // why the route-coverage suite never saw it.
    //
    // This test fails once the guard is added. Replace it then with the real
    // assertions: progress counter, one question per word, and the results
    // screen.
    await expect(page.getByRole("heading", { name: /something went wrong/i })).toBeVisible();
  });

  test("refuses to run without enough words to make choices", async ({ page, db }) => {
    seedLesson(db, 3);
    await page.goto(`/quiz/${LESSON}`);

    // Four options are needed for a multiple choice; three words would make the
    // right answer guessable by elimination.
    await expect(page.getByText(/محتاج كلمات أكثر/)).toBeVisible();
    await expect(page.getByText(/٤ كلمات على الأقل/)).toBeVisible();
  });

  test("says so for an id that matches nothing", async ({ page, db }) => {
    db.seed("lessons", []);
    db.seed("topics", []);
    await page.goto(`/quiz/${lessonId(9)}`);

    await expect(page.getByText(/ما لقينا الموضوع/)).toBeVisible();
  });
});

test.describe("the curriculum overview", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedLesson(db, 4);
  });

  test("links a lesson row into the lesson runner", async ({ page }) => {
    await page.goto("/curriculum");

    await page.getByRole("link", { name: /Greetings/ }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/${LESSON}$`));
  });

  test("shows a lesson in progress with how far through it is", async ({ page, db }) => {
    db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "in_progress",
        last_word_index: 1,
        words_seen: 2,
        words_total: 4,
      }),
    ]);

    await page.goto("/curriculum");
    await expect(page.getByText(/50% through/)).toBeVisible();
  });

  test("counts the words in a lesson through the relationship", async ({ page }) => {
    await page.goto("/curriculum");

    // Resolved by the backend from real rows rather than a pre-shaped embed, so
    // this exercises the `vocabulary_words(id)` join the page actually issues.
    await expect(page.getByText(/4 words/)).toBeVisible();
  });
});
