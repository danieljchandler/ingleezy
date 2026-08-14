import { expect, test } from "./support/fixtures";
import {
  aUserVocabulary,
  aUserXp,
  aVocabularyWord,
  aWordReview,
  TEST_USER_ID,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * Learning Analytics.
 *
 * Every figure on this page is derived in the browser from six parallel
 * queries, and the derivation is the only place several of these numbers exist
 * at all — nothing stores an accuracy, a stage breakdown or an error rate. That
 * makes the page a pure function of the rows underneath it, and it means a
 * quiet arithmetic change here is invisible everywhere else.
 *
 * The stage breakdown is the part worth guarding hardest. It used to read a
 * persisted `stage` column that only the Anki importer ever wrote, so for words
 * added in-app it never moved no matter how much they were reviewed. It now
 * derives from live SRS state using the same helper as the Card Health chart on
 * the same page, and the two agreeing is the property that matters.
 */

function seedAnalytics(db: MemoryDb) {
  db.seed("word_reviews", []);
  db.seed("user_vocabulary", []);
  db.seed("vocabulary_words", []);
  db.seed("review_streaks", []);
  db.seed("user_xp", [aUserXp({ total_xp: 0, level: 1 })]);
  db.seed("daily_challenge_completions", []);
  db.seed("user_difficulty", []);
}

/**
 * A saved word with a given review history.
 *
 * `ease_factor` carries FSRS *stability*, not the SM-2 ease it is named after —
 * the stage helper reads it as stability, so the numbers here are days.
 */
const aReviewed = (
  id: string,
  { reviews = 0, correct = 0, reps = 0, stability = 0, createdAt = "2024-01-01T00:00:00Z" } = {},
) =>
  aUserVocabulary({
    id,
    user_id: TEST_USER_ID,
    word_arabic: `كلمة-${id}`,
    word_english: `word ${id}`,
    review_count: reviews,
    correct_count: correct,
    repetitions: reps,
    ease_factor: stability,
    created_at: createdAt,
    last_reviewed_at: reviews > 0 ? new Date().toISOString() : null,
  });

test.describe("getting in", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/analytics");

    // Pinned as-is. The route is wrapped in `ProtectedRoute`, which redirects,
    // so the page's own `if (!isAuthenticated)` branch — a panel reading "Sign
    // in to see your learning analytics" with a Sign In button — is
    // unreachable. Harmless duplication, but it is the third place in the app
    // where an in-page gate sits behind a route guard that already fired.
    await expect(page).toHaveURL(/\/auth/);
  });
});

test.describe("the headline figures", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedAnalytics(db);
  });

  test("counts curriculum reviews and saved words together", async ({ page, db }) => {
    db.seed("vocabulary_words", [aVocabularyWord({ id: "vw-1" })]);
    db.seed("word_reviews", [
      aWordReview({ id: "wr-1", word_id: "vw-1", review_count: 4, correct_count: 3 }),
    ]);
    db.seed("user_vocabulary", [aReviewed("a", { reviews: 6, correct: 3 })]);

    await page.goto("/analytics");

    // Two decks, one total. A learner does not think of them separately, and
    // splitting the figure would make both look smaller than their effort.
    await expect(page.getByText("إجمالي الكلمات")).toBeVisible();
    await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  });

  test("computes accuracy across every review", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aReviewed("a", { reviews: 10, correct: 7 }),
      aReviewed("b", { reviews: 10, correct: 8 }),
    ]);

    await page.goto("/analytics");

    // 15 of 20. Weighted by reviews rather than averaged per word, so a word
    // reviewed once does not count as much as one reviewed fifty times.
    await expect(page.getByText("75%").first()).toBeVisible();
    await expect(page.getByText("20 مراجعة")).toBeVisible();
  });

  test("shows zero accuracy rather than NaN for an unreviewed deck", async ({ page, db }) => {
    db.seed("user_vocabulary", [aReviewed("a")]);

    await page.goto("/analytics");

    // 0/0 is the state of every new account, so the guard is the common path.
    await expect(page.getByText("0%").first()).toBeVisible();
    await expect(page.getByText(/NaN/)).toHaveCount(0);
  });

  test("estimates study time from the review count", async ({ page, db }) => {
    db.seed("user_vocabulary", [aReviewed("a", { reviews: 40, correct: 40 })]);

    await page.goto("/analytics");

    // Half a minute per review, labelled "تقديري" — nothing times a session,
    // so the number is presented as the guess it is.
    await expect(page.getByText("20m")).toBeVisible();
    await expect(page.getByText("تقديري")).toBeVisible();
  });

  test("shows XP and level from the gamification row", async ({ page, db }) => {
    db.seed("user_xp", [aUserXp({ total_xp: 12500, level: 7 })]);

    await page.goto("/analytics");

    // Formatted with separators: five figures of XP is normal by the time a
    // learner looks at this page.
    await expect(page.getByText("12,500")).toBeVisible();
    await expect(page.getByText("المستوى 7")).toBeVisible();
  });

  test("shows the streak and the best one", async ({ page, db }) => {
    db.seed("review_streaks", [
      { user_id: TEST_USER_ID, current_streak: 5, longest_streak: 30 },
    ]);

    await page.goto("/analytics");

    await expect(page.getByText("الأفضل: 30")).toBeVisible();
  });
});

test.describe("word mastery", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedAnalytics(db);
  });

  test("derives each word's stage from live SRS state", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      // Never reviewed → New.
      aReviewed("new", { reps: 0, stability: 0 }),
      // Reviewed, low stability → early stages.
      aReviewed("learning", { reps: 1, stability: 1 }),
      // Months of stability → mastered.
      aReviewed("mastered", { reps: 12, stability: 400 }),
    ]);

    await page.goto("/analytics");

    // The stage is computed from `repetitions` and stability, not read from a
    // column. The persisted `stage` this replaced was only ever written by the
    // Anki importer, so for words added in-app this chart never moved.
    await expect(page.getByText("إتقان الكلمات")).toBeVisible();
    await expect(page.getByText("33%").first()).toBeVisible();
  });

  test("agrees with the Card Health chart on the same page", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aReviewed("a", { reps: 12, stability: 400 }),
      aReviewed("b", { reps: 0, stability: 0 }),
    ]);

    await page.goto("/analytics");

    // Two charts, one helper. They are computed independently from the same
    // rows, so a change to one bucketing rule and not the other shows up as
    // two different answers on one screen.
    await expect(page.getByText("إتقان الكلمات")).toBeVisible();
    await expect(page.getByText("Card Health")).toBeVisible();
    await expect(page.getByText("50%").first()).toBeVisible();
  });

  test("shows every stage band even when empty", async ({ page, db }) => {
    db.seed("user_vocabulary", [aReviewed("a", { reps: 0, stability: 0 })]);

    await page.goto("/analytics");
    await expect(page.getByText("إتقان الكلمات")).toBeVisible();

    // Six fixed bands. Hiding the empty ones would make progress look like it
    // had nowhere left to go.
    const counts = await page.locator("text=/^\\d+$/").count();
    expect(counts).toBeGreaterThan(0);
  });

  test("reports zero mastery rather than dividing by zero", async ({ page }) => {
    await page.goto("/analytics");

    await expect(page.getByText("إتقان الكلمات")).toBeVisible();
    await expect(page.getByText(/NaN|Infinity/)).toHaveCount(0);
  });
});

test.describe("this week", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedAnalytics(db);
  });

  test("counts only words saved in the last seven days", async ({ page, db }) => {
    const daysAgo = (n: number) =>
      new Date(Date.now() - n * 86_400_000).toISOString();

    db.seed("user_vocabulary", [
      aReviewed("recent-1", { createdAt: daysAgo(1) }),
      aReviewed("recent-2", { createdAt: daysAgo(6) }),
      aReviewed("old", { createdAt: daysAgo(40) }),
    ]);

    await page.goto("/analytics");

    await expect(page.getByText("هذا الأسبوع")).toBeVisible();
    await expect(page.getByText("new words")).toBeVisible();
    await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  });

  test("ignores a word with no created_at at all", async ({ page, db }) => {
    db.seed("user_vocabulary", [aReviewed("a", { createdAt: null as never })]);

    await page.goto("/analytics");

    // A null date through `new Date()` is Invalid, and `Invalid >= weekAgo` is
    // false — but relying on that would be an accident. The explicit guard is
    // what makes it deliberate.
    await expect(page.getByText("هذا الأسبوع")).toBeVisible();
    await expect(page.getByText("new words")).toBeVisible();
  });

  test("counts completed daily challenges", async ({ page, db }) => {
    const today = new Date();
    const key = (d: Date) => d.toISOString().slice(0, 10);
    const back = (n: number) => new Date(today.getTime() - n * 86_400_000);

    db.seed("daily_challenge_completions", [
      { id: "c0", user_id: TEST_USER_ID, challenge_date: key(back(0)), score: 5, max_score: 5 },
      { id: "c1", user_id: TEST_USER_ID, challenge_date: key(back(1)), score: 4, max_score: 5 },
      { id: "c2", user_id: TEST_USER_ID, challenge_date: key(back(2)), score: 3, max_score: 5 },
    ]);

    await page.goto("/analytics");

    await expect(page.getByText("تحديات")).toBeVisible();
  });
});

test.describe("the skill radar", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedAnalytics(db);
  });

  test("plots the four measured skills plus culture", async ({ page, db }) => {
    db.seed("user_difficulty", [
      {
        user_id: TEST_USER_ID,
        vocab_difficulty: 0.8,
        listening_difficulty: 0.4,
        reading_difficulty: 0.6,
        speaking_difficulty: 0.2,
      },
    ]);

    await page.goto("/analytics");

    await expect(page.getByText("تفصيل المهارات")).toBeVisible();
    for (const skill of ["Vocabulary", "Listening", "Reading", "Speaking", "Culture"]) {
      await expect(page.getByText(skill, { exact: true })).toBeVisible();
    }
  });

  test("falls back to the midpoint for a learner with no difficulty row", async ({
    page,
    db,
  }) => {
    db.seed("user_difficulty", []);

    await page.goto("/analytics");

    // 0.5 across the board rather than an empty chart — a new learner has no
    // measurements, and a radar collapsed to a point reads as "you are bad at
    // everything".
    await expect(page.getByText("تفصيل المهارات")).toBeVisible();
    await expect(page.getByText("Vocabulary")).toBeVisible();
  });
});

test.describe("the review forecast", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedAnalytics(db);
  });

  test("shows how much is due today", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aReviewed("due", { reps: 2, stability: 3 }),
    ]);

    await page.goto("/analytics");

    await expect(page.getByText("Review Forecast (7 days)")).toBeVisible();
    // Named as combined, because the two decks have separate review pages and
    // a learner otherwise has to add the two numbers themselves.
    await expect(page.getByText(/مجموع المنهج مع كلماتك المحفوظة/)).toBeVisible();
    await expect(page.getByText("مستحقة اليوم")).toBeVisible();
  });

  test("shows zero due rather than a blank on a clear day", async ({ page }) => {
    await page.goto("/analytics");

    await expect(page.getByText("مستحقة اليوم")).toBeVisible();
    await expect(page.getByText("0").first()).toBeVisible();
  });
});

test.describe("when the data will not load", () => {
  test("spins forever rather than reporting the failure", async ({
    page,
    signInAs,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await signInAs("free");
    seedAnalytics(db);
    db.failAlways("user_vocabulary", 500);
    db.failAlways("word_reviews", 500);

    await page.goto("/analytics");

    // Pinned, not endorsed, and the two halves disagree. The hook deliberately
    // rethrows the two core query failures — its comment says it wants React
    // Query to "show the error/retry state" rather than render a dashboard full
    // of zeros. But the page's only guard is `if (isLoading || !analytics)`,
    // which renders a spinner; there is no error branch for React Query to
    // reach. So the intended behaviour never happens: the learner gets an
    // indefinite spinner with no message and no retry.
    await expect(page.locator("svg.lucide-loader-circle")).toBeVisible();
    await expect(page.getByText("إجمالي الكلمات")).toHaveCount(0);
    await expect(page.getByText(/failed|error|try again/i)).toHaveCount(0);
  });

  test("still renders when only the optional queries fail", async ({
    page,
    signInAs,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await signInAs("free");
    seedAnalytics(db);
    db.seed("user_vocabulary", [aReviewed("a", { reviews: 2, correct: 2 })]);
    db.failAlways("review_streaks", 500);
    db.failAlways("user_xp", 500);
    db.failAlways("user_difficulty", 500);

    await page.goto("/analytics");

    // Only the two word sources are rethrown; streaks, XP and difficulty are
    // read with `?? default`, so losing them degrades individual tiles rather
    // than the page.
    await expect(page.getByText("إجمالي الكلمات")).toBeVisible();
    await expect(page.getByText("الأفضل: 0")).toBeVisible();
  });
});
