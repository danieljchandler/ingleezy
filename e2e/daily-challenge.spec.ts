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

const startButton = (page: Page) => page.getByRole("button", { name: "ابدأ تحدي اليوم" });
const options = (page: Page) => page.getByRole("group", { name: "الخيارات" }).getByRole("button");

const aGeneratedChallenge = (over: Record<string, unknown> = {}) => ({
  challenge: {
    type: "vocab",
    title: "Freshly generated",
    titleArabic: "مولّد",
    questions: [
      { prompt: "كيف تقول «باب» بالإنجليزي؟", options: ["door", "book"], answer: "door" },
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

    await expect(page.getByRole("heading", { name: /تحدي اليوم/ })).toBeVisible();
    await expect(page.getByText("خلّص تحدي اليوم عشان تحافظ على سلسلتك!")).toBeVisible();
    await expect(startButton(page)).toBeVisible();
  });

  test("starts a signed-in learner at a zero streak", async ({ page }) => {
    await page.goto("/daily-challenge");

    await expect(page.getByText("يوم متتالي")).toBeVisible();
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
    await expect(page.getByText("يوم متتالي")).toBeVisible();
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
    // "مكافأة السلسلة" line never renders, and the advertised bonus is
    // unreachable no matter how long the streak.
    db.seed("daily_challenge_completions", [
      aChallengeCompletion({ id: challengeCompletionId(0), challenge_date: isoDate(1) }),
      aChallengeCompletion({ id: challengeCompletionId(1), challenge_date: isoDate(2) }),
      aChallengeCompletion({ id: challengeCompletionId(2), challenge_date: isoDate(3) }),
    ]);
    seedPool(db);

    await page.goto("/daily-challenge");
    await startButton(page).click();

    await page.getByRole("button", { name: "door" }).click();
    await page.getByRole("button", { name: "التالي" }).click();
    await page.getByRole("button", { name: "book" }).click();
    await page.getByRole("button", { name: "شوف النتيجة" }).click();

    // Two correct at the base 15 XP, with no multiplier applied.
    await expect(page.getByText("حصّلت 30 نقطة خبرة")).toBeVisible();
    await expect(page.getByText(/مكافأة السلسلة/)).toHaveCount(0);
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
    await expect(page.getByRole("button", { name: "سجّل دخولك عشان نتابع سلسلتك" })).toBeVisible();
    await expect(startButton(page)).toBeVisible();
    await expect(page.getByText("يوم متتالي")).toHaveCount(0);
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

    await expect(page.getByText("تعذّر تحميل تحدي اليوم")).toBeVisible();
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

    await expect(page.getByText("كيف تقول «باب» بالإنجليزي؟")).toBeVisible();
    await expect(options(page)).toHaveCount(3);
  });

  test("confirms a right answer", async ({ page }) => {
    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: "door" }).click();

    await expect(page.getByText("صح!")).toBeVisible();
    await expect(page.getByText("النتيجة: 1")).toBeVisible();
  });

  test("shows the right answer after a wrong one", async ({ page }) => {
    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: "chair" }).click();

    // Being told what it should have been is the only teaching this screen
    // does — a bare "wrong" leaves nothing learned.
    await expect(page.getByText("الجواب: door")).toBeVisible();
    await expect(page.getByText("النتيجة: 0")).toBeVisible();
  });

  test("takes no second answer once one is given", async ({ page }) => {
    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: "chair" }).click();
    await expect(page.getByText("الجواب: door")).toBeVisible();

    await expect(page.getByRole("button", { name: "door" })).toBeDisabled();
    await expect(page.getByText("النتيجة: 0")).toBeVisible();
  });

  test("moves on and finishes on the last question", async ({ page }) => {
    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: "door" }).click();
    await page.getByRole("button", { name: "التالي" }).click();

    await expect(page.getByText("كيف تقول «كتاب» بالإنجليزي؟")).toBeVisible();
    await page.getByRole("button", { name: "book" }).click();
    // The last question offers results rather than another Next.
    await expect(page.getByRole("button", { name: "شوف النتيجة" })).toBeVisible();
  });

  test("hides the meaning until it is asked for", async ({ page, db }) => {
    seedPool(db, {
      questions: [
        {
          sentence: "How are you ___?",
          sentenceEnglish: "شلونك اليوم؟",
          options: ["today", "yesterday"],
          answer: "today",
        },
      ],
    });

    await page.goto("/daily-challenge");
    await startButton(page).click();

    // The English is the task, so it is read before the dialect explains it.
    await expect(page.getByText(/How are you/)).toBeVisible();
    await expect(page.getByText("شلونك اليوم؟")).toHaveCount(0);
    await page.getByRole("switch", { name: "أظهر المعنى" }).click();
    await expect(page.getByText("شلونك اليوم؟")).toBeVisible();
  });

  test("fills the gap with the answer once it is given", async ({ page, db }) => {
    seedPool(db, {
      questions: [{ sentence: "She is good ___ math.", options: ["at", "in"], answer: "at" }],
    });

    await page.goto("/daily-challenge");
    await startButton(page).click();
    await page.getByRole("button", { name: "in", exact: true }).click();

    // The sentence is shown whole and right, not just the word in a banner.
    await expect(page.getByText("She is good at math.")).toBeVisible();
  });

  test("shows the hint in the learner's dialect", async ({ page, db }) => {
    seedPool(db, {
      questions: [{ scrambled: "market the went to I", hint: "رحت السوق", answer: "I went to the market" }],
    });

    await page.goto("/daily-challenge");
    await startButton(page).click();

    await expect(page.getByText("تلميح: رحت السوق")).toBeVisible();
  });
});

test.describe("answering without options", () => {
  // The pool's word-order and fill-in rows carry no options. Until 2026-10-03
  // the page could only answer by picking one, so those rows showed a question
  // with nothing to press.
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("daily_challenge_completions", []);
  });

  const sentence = (page: Page) => page.getByRole("group", { name: "جملتك" });
  const wordBank = (page: Page) => page.getByRole("group", { name: "الكلمات" });

  async function startWordOrder(page: Page, db: MemoryDb) {
    seedPool(db, {
      questions: [{ scrambled: "market the went to I", hint: "رحت السوق", answer: "I went to the market." }],
    });
    await page.goto("/daily-challenge");
    await startButton(page).click();
  }

  test("rebuilds a scrambled sentence word by word", async ({ page, db }) => {
    await startWordOrder(page, db);

    for (const word of ["I", "went", "to", "the", "market"]) {
      await wordBank(page).getByRole("button", { name: word, exact: true }).click();
    }
    await page.getByRole("button", { name: "تحقق" }).click();

    // Spacing and the closing full stop are not what is being tested.
    await expect(page.getByText("صح!")).toBeVisible();
    await expect(page.getByText("النتيجة: 1")).toBeVisible();
  });

  test("checks only once every word is placed", async ({ page, db }) => {
    await startWordOrder(page, db);

    await wordBank(page).getByRole("button", { name: "I", exact: true }).click();

    await expect(page.getByRole("button", { name: "تحقق" })).toBeDisabled();
  });

  test("gives a placed word back when it is tapped", async ({ page, db }) => {
    await startWordOrder(page, db);

    await wordBank(page).getByRole("button", { name: "market" }).click();
    await expect(wordBank(page).getByRole("button", { name: "market" })).toHaveCount(0);
    await sentence(page).getByRole("button", { name: "market" }).click();

    await expect(sentence(page).getByRole("button")).toHaveCount(0);
    await expect(wordBank(page).getByRole("button", { name: "market" })).toBeVisible();
  });

  test("marks a wrong order and shows the sentence", async ({ page, db }) => {
    await startWordOrder(page, db);

    for (const word of ["I", "went", "the", "to", "market"]) {
      await wordBank(page).getByRole("button", { name: word, exact: true }).click();
    }
    await page.getByRole("button", { name: "تحقق" }).click();

    await expect(page.getByText("الجواب: I went to the market.")).toBeVisible();
    await expect(page.getByText("النتيجة: 0")).toBeVisible();
  });

  test("takes a typed answer when there is nothing to pick", async ({ page, db }) => {
    seedPool(db, {
      questions: [{ sentence: "I ___ from Kuwait.", sentenceEnglish: "أنا من الكويت.", answer: "am" }],
    });
    await page.goto("/daily-challenge");
    await startButton(page).click();

    // Capitals and stray spaces are forgiven; the word is what counts.
    await page.getByRole("textbox", { name: "جوابك بالإنجليزي" }).fill(" Am ");
    await page.getByRole("button", { name: "تحقق" }).click();

    await expect(page.getByText("صح!")).toBeVisible();
    await expect(page.getByText("I am from Kuwait.")).toBeVisible();
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
    await page.getByRole("button", { name: correct ? "door" : "chair" }).click();
    await page.getByRole("button", { name: "التالي" }).click();
    await page.getByRole("button", { name: correct ? "book" : "door" }).click();
    await page.getByRole("button", { name: "شوف النتيجة" }).click();
  }

  test("reports the score out of the total", async ({ page }) => {
    await playThrough(page, true);

    await expect(page.getByRole("heading", { name: "خلّصت التحدي!" })).toBeVisible();
    await expect(page.getByText("2/2")).toBeVisible();
  });

  test("pays XP per correct answer, not per attempt", async ({ page }) => {
    await playThrough(page, false);

    // Nothing right, nothing earned — the streak is the participation reward.
    await expect(page.getByText("0/2")).toBeVisible();
    await expect(page.getByText("حصّلت 0 نقطة خبرة")).toBeVisible();
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
    await expect(page.getByText("حصّلت 30 نقطة خبرة")).toBeVisible();

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
