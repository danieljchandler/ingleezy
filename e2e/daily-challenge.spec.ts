import { expect, test } from "./support/fixtures";
import {
  aChallengeCompletion,
  aDailyChallenge,
  aVocabularyWord,
  wordId,
  challengeCompletionId,
  dailyChallengeId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * The daily challenge — the app's streak mechanic.
 *
 * Two things carry the weight here. The streak is recomputed client-side by
 * walking back from today one day at a time through the completion rows, so it
 * is only ever as right as the dates in them; and the streak multiplies the XP
 * awarded, so an off-by-one is a payout error rather than a cosmetic one.
 *
 * The content itself comes from one of two places: a pool of pre-approved
 * challenges if any are published, and live AI generation if not. The pool is
 * sampled at random, so tests that care about the questions seed exactly one
 * row.
 */

/** Local date in the same form the page writes and compares. */
function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const startButton = (page: Page) => page.getByRole("button", { name: "Start Today's Challenge" });
const options = (page: Page) => page.locator("button.rounded-xl.border-2");

const aGeneratedChallenge = (over: Record<string, unknown> = {}) => ({
  challenge: {
    type: "vocab",
    title: "Freshly generated",
    titleArabic: "مولّد",
    questions: [
      { prompt: "What is 'door'?", options: ["باب", "كتاب"], answer: "باب" },
    ],
  },
  streakMultiplier: 1.0,
  baseXP: 15,
  ...over,
});

/** A published challenge pool of exactly one, so the random pick is fixed. */
function seedPool(db: MemoryDb, over: Record<string, unknown> = {}) {
  db.seed("daily_challenges", [aDailyChallenge({ id: dailyChallengeId(0), ...over })]);
}

/**
 * `days` consecutive completions ending today.
 *
 * Ending *today* is load-bearing. The streak is counted by walking back from
 * today one day at a time and stopping at the first date that does not match,
 * so a chain that ends yesterday counts as zero — see the pinned tests below.
 */
function seedStreak(db: MemoryDb, days: number) {
  db.seed(
    "daily_challenge_completions",
    Array.from({ length: days }, (_, index) =>
      aChallengeCompletion({
        id: challengeCompletionId(index),
        challenge_date: isoDate(index),
      }),
    ),
  );
}

test.describe("the landing screen", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("daily_challenge_completions", []);
    db.seed("daily_challenges", []);
  });

  test("explains what the challenge is for", async ({ page }) => {
    await page.goto("/daily-challenge");

    await expect(page.getByRole("heading", { name: /Daily Challenge/ })).toBeVisible();
    await expect(page.getByText("Complete today's challenge to keep your streak!")).toBeVisible();
    await expect(startButton(page)).toBeVisible();
  });

  test("starts a signed-in learner at a zero streak", async ({ page }) => {
    await page.goto("/daily-challenge");

    await expect(page.getByText("Day Streak")).toBeVisible();
    await expect(page.getByText("0", { exact: true })).toBeVisible();
  });

  test("counts consecutive days ending today", async ({ page, db }) => {
    seedStreak(db, 4);

    await page.goto("/daily-challenge");

    await expect(page.getByText("4", { exact: true })).toBeVisible();
  });

  test("counts an unbroken run ending yesterday as nothing", async ({ page, db }) => {
    db.seed("daily_challenge_completions", [
      aChallengeCompletion({ id: challengeCompletionId(0), challenge_date: isoDate(1) }),
      aChallengeCompletion({ id: challengeCompletionId(1), challenge_date: isoDate(2) }),
      aChallengeCompletion({ id: challengeCompletionId(2), challenge_date: isoDate(3) }),
    ]);

    await page.goto("/daily-challenge");

    // Pinned, not fixed. The walk starts at today, so a learner who has played
    // three days running and has not yet played today is shown a streak of 0 —
    // exactly when the number is meant to be motivating them to play. It only
    // reads correctly *after* today's challenge is done, which is the one
    // moment the landing screen is replaced by "come back tomorrow".
    await expect(page.getByText("Day Streak")).toBeVisible();
    await expect(page.getByText("0", { exact: true })).toBeVisible();
  });

  test("stops the streak at the first gap", async ({ page, db }) => {
    db.seed("daily_challenge_completions", [
      aChallengeCompletion({ id: challengeCompletionId(0), challenge_date: isoDate(0) }),
      // Yesterday is missing, so everything older is out of the chain.
      aChallengeCompletion({ id: challengeCompletionId(1), challenge_date: isoDate(3) }),
      aChallengeCompletion({ id: challengeCompletionId(2), challenge_date: isoDate(4) }),
    ]);

    await page.goto("/daily-challenge");

    await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  });

  test("promises a bonus once the streak is worth keeping", async ({ page, db }) => {
    seedStreak(db, 3);

    await page.goto("/daily-challenge");

    await expect(page.getByText("1.5x XP Bonus! ⚡")).toBeVisible();
  });

  test("promises a bigger bonus at a week", async ({ page, db }) => {
    seedStreak(db, 7);

    await page.goto("/daily-challenge");

    await expect(page.getByText("2x XP Bonus! 🔥")).toBeVisible();
  });

  test("offers no bonus below three days", async ({ page, db }) => {
    seedStreak(db, 2);

    await page.goto("/daily-challenge");

    await expect(page.getByText(/XP Bonus/)).toHaveCount(0);
  });

  test("never actually pays the streak bonus it advertises", async ({ page, db }) => {
    // Pinned, not fixed, and the two halves compound.
    //
    // The badge is chosen by day count (3 → "1.5x", 7 → "2x") while the
    // multiplier applied is `1 + streak * 0.1` — so even at face value a
    // three-day streak is promised 1.5x and would pay 1.3x.
    //
    // But the streak passed to that formula is the same one counted from today,
    // and today's challenge is by definition unfinished at the moment it is
    // read. So the multiplier is 1 + 0 * 0.1 = 1.0 on every single run, the
    // "streak bonus applied" line never renders, and the advertised bonus is
    // unreachable no matter how long the streak.
    db.seed("daily_challenge_completions", [
      aChallengeCompletion({ id: challengeCompletionId(0), challenge_date: isoDate(1) }),
      aChallengeCompletion({ id: challengeCompletionId(1), challenge_date: isoDate(2) }),
      aChallengeCompletion({ id: challengeCompletionId(2), challenge_date: isoDate(3) }),
    ]);
    seedPool(db);

    await page.goto("/daily-challenge");
    await startButton(page).click();

    await page.getByRole("button", { name: "باب" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "كتاب" }).click();
    await page.getByRole("button", { name: "See Results" }).click();

    // Two correct at the base 15 XP, with no multiplier applied.
    await expect(page.getByText("+30 XP earned")).toBeVisible();
    await expect(page.getByText(/streak bonus applied/)).toHaveCount(0);
  });

  test("says the day is done and offers no second run", async ({ page, db }) => {
    db.seed("daily_challenge_completions", [
      aChallengeCompletion({ challenge_date: isoDate(0), xp_earned: 45 }),
    ]);

    await page.goto("/daily-challenge");

    // One challenge a day is what makes the streak mean anything.
    await expect(page.getByText("You earned 45 XP today. Come back tomorrow!")).toBeVisible();
    await expect(startButton(page)).toHaveCount(0);
  });

  test("invites a signed-out visitor to sign in for a streak", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/daily-challenge");

    // Not a gate: the challenge is playable signed out, only the streak needs
    // an account.
    await expect(page.getByRole("button", { name: "Sign in to track your streak" })).toBeVisible();
    await expect(startButton(page)).toBeVisible();
    await expect(page.getByText("Day Streak")).toHaveCount(0);
  });
});

test.describe("where the challenge comes from", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("daily_challenge_completions", []);
  });

  test("prefers an approved challenge over generating one", async ({ page, db, backend }) => {
    seedPool(db, { title: "Curated words" });

    await page.goto("/daily-challenge");
    await startButton(page).click();

    // Human-reviewed content costs nothing and is known good; generating when a
    // pool exists is both slower and riskier.
    await expect(page.getByText("Curated words")).toBeVisible();
    expect(backend.callsTo("daily-challenge")).toHaveLength(0);
  });

  test("generates one when the pool is empty", async ({ page, db, backend }) => {
    db.seed("daily_challenges", []);
    // `useAllWords` reads the curriculum table, not the learner's saved words.
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), word_arabic: "باب", word_english: "door" }),
    ]);
    backend.stubFunction("daily-challenge", aGeneratedChallenge());

    await page.goto("/daily-challenge");
    await startButton(page).click();

    await expect(page.getByText("Freshly generated")).toBeVisible();
    expect(backend.lastCallTo("daily-challenge")?.body).toMatchObject({
      dialect: "Gulf",
      streakDays: 0,
    });
  });

  test("sends the learner's own words as a cold-start hint", async ({ page, db, backend }) => {
    db.seed("daily_challenges", []);
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), word_arabic: "باب", word_english: "door", display_order: 0 }),
      aVocabularyWord({ id: wordId(1), word_arabic: "كتاب", word_english: "book", display_order: 1 }),
    ]);
    backend.stubFunction("daily-challenge", aGeneratedChallenge());

    await page.goto("/daily-challenge");
    await startButton(page).click();
    await expect(page.getByText("Freshly generated")).toBeVisible();

    const sent = backend.lastCallTo("daily-challenge")?.body as {
      userVocab: Array<Record<string, string>>;
    };
    // Order is the hook's business, not this page's — what matters is that the
    // learner's own curriculum words are what the generator is given to work
    // from, rather than a generic list.
    expect(sent.userVocab.map((w) => w.word_arabic).sort()).toEqual(["باب", "كتاب"].sort());
  });

  test("ignores an unpublished challenge", async ({ page, db, backend }) => {
    db.seed("daily_challenges", [aDailyChallenge({ status: "draft", title: "Not ready" })]);
    db.seed("vocabulary_words", []);
    backend.stubFunction("daily-challenge", aGeneratedChallenge());

    await page.goto("/daily-challenge");
    await startButton(page).click();

    await expect(page.getByText("Freshly generated")).toBeVisible();
    await expect(page.getByText("Not ready")).toHaveCount(0);
  });

  test("says so when nothing can be loaded", async ({ page, db, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/Failed to load challenge/]);
    db.seed("daily_challenges", []);
    db.seed("vocabulary_words", []);
    backend.stubFunctionFailure("daily-challenge", 500, { error: "model unavailable" });

    await page.goto("/daily-challenge");
    await startButton(page).click();

    await expect(page.getByText("Failed to load today's challenge")).toBeVisible();
    // Back on the landing screen, so it can be retried.
    await expect(startButton(page)).toBeVisible();
  });
});

test.describe("answering", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("daily_challenge_completions", []);
    seedPool(db);
  });

  test("shows the prompt and every option", async ({ page }) => {
    await page.goto("/daily-challenge");
    await startButton(page).click();

    await expect(page.getByText("What is 'door'?")).toBeVisible();
    await expect(options(page)).toHaveCount(3);
  });

  test("confirms a right answer", async ({ page }) => {
    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: "باب" }).click();

    await expect(page.getByText("Correct!")).toBeVisible();
    await expect(page.getByText("Score: 1")).toBeVisible();
  });

  test("shows the right answer after a wrong one", async ({ page }) => {
    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: "كرسي" }).click();

    // Being told what it should have been is the only teaching this screen
    // does — a bare "wrong" leaves nothing learned.
    await expect(page.getByText("Answer: باب")).toBeVisible();
    await expect(page.getByText("Score: 0")).toBeVisible();
  });

  test("takes no second answer once one is given", async ({ page }) => {
    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: "كرسي" }).click();
    await expect(page.getByText("Answer: باب")).toBeVisible();

    await expect(page.getByRole("button", { name: "باب" })).toBeDisabled();
    await expect(page.getByText("Score: 0")).toBeVisible();
  });

  test("moves on and finishes on the last question", async ({ page }) => {
    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: "باب" }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByText("What is 'book'?")).toBeVisible();
    await page.getByRole("button", { name: "كتاب" }).click();
    // The last question offers results rather than another Next.
    await expect(page.getByRole("button", { name: "See Results" })).toBeVisible();
  });

  test("hides the English until it is asked for", async ({ page, db }) => {
    seedPool(db, {
      questions: [
        {
          sentence: "شلونك اليوم",
          sentenceEnglish: "How are you today",
          options: ["بخير", "مع السلامة"],
          answer: "بخير",
        },
      ],
    });

    await page.goto("/daily-challenge");
    await startButton(page).click();

    await expect(page.getByText("شلونك اليوم")).toBeVisible();
    await expect(page.getByText("How are you today")).toHaveCount(0);
    await page.getByRole("switch").click();
    await expect(page.getByText("How are you today")).toBeVisible();
  });

  test("shows a hint on a scrambled question", async ({ page, db }) => {
    seedPool(db, {
      questions: [
        {
          scrambled: "ك ت ا ب",
          hint: "You read it",
          options: ["كتاب", "باب"],
          answer: "كتاب",
        },
      ],
    });

    await page.goto("/daily-challenge");
    await startButton(page).click();

    await expect(page.getByText("Hint: You read it")).toBeVisible();
  });
});

test.describe("finishing", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("daily_challenge_completions", []);
    seedPool(db);
  });

  async function playThrough(page: Page, correct: boolean) {
    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: correct ? "باب" : "كرسي" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: correct ? "كتاب" : "باب" }).click();
    await page.getByRole("button", { name: "See Results" }).click();
  }

  test("reports the score out of the total", async ({ page }) => {
    await playThrough(page, true);

    await expect(page.getByRole("heading", { name: "Challenge Complete!" })).toBeVisible();
    await expect(page.getByText("2/2")).toBeVisible();
  });

  test("pays XP per correct answer, not per attempt", async ({ page }) => {
    await playThrough(page, false);

    // Nothing right, nothing earned — the streak is the participation reward.
    await expect(page.getByText("0/2")).toBeVisible();
    await expect(page.getByText("+0 XP earned")).toBeVisible();
  });

  test("records the completion so the streak continues", async ({ page, db }) => {
    await playThrough(page, true);
    await expect(page.getByText("2/2")).toBeVisible();

    await expect
      .poll(() => db.writesTo("daily_challenge_completions").length)
      .toBeGreaterThan(0);
    expect(db.lastWriteTo("daily_challenge_completions")?.payload[0]).toMatchObject({
      challenge_date: isoDate(0),
      challenge_type: "vocab",
      score: 2,
      max_score: 2,
      xp_earned: 30,
    });
  });

  test("awards the XP it reported", async ({ page, db }) => {
    await playThrough(page, true);
    await expect(page.getByText("+30 XP earned")).toBeVisible();

    // The completion row and the XP ledger have to agree, or the profile total
    // and the challenge history tell different stories.
    await expect.poll(() => db.writesTo("daily_challenge_completions").length).toBeGreaterThan(0);
    expect(db.lastWriteTo("daily_challenge_completions")?.payload[0].xp_earned).toBe(30);
  });

  test("records nothing for a signed-out visitor", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    db.seed("daily_challenge_completions", []);
    seedPool(db);

    await playThrough(page, true);

    await expect(page.getByText("2/2")).toBeVisible();
    expect(db.lastWriteTo("daily_challenge_completions")).toBeUndefined();
  });
});
