import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aChallengeCompletion,
  aUserVocabulary,
  aUserXp,
  aWordReview,
  challengeCompletionId,
  daysAgo,
  reviewId,
  TEST_USER_ID,
  vocabId,
} from "@/test/support/factories";
import { useLearningAnalytics } from "./useAnalytics";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The analytics dashboard — every number a learner sees about their own
 * progress.
 *
 * It exists because spaced repetition is invisible from the inside. A learner
 * doing fifteen minutes a day cannot tell whether they are getting anywhere,
 * and "am I actually improving" is the question that decides whether they are
 * still here in three months. So the numbers have to be true: a chart that
 * never moves is worse than no chart, because it says the work is not working.
 *
 * That is not hypothetical here. The stage breakdown used to read a persisted
 * `stage` column that only the Anki importer ever wrote, so for words added
 * in the app it sat at its default forever and the chart never moved. It is
 * derived from live SRS state now, using the same helper as the card-health
 * chart beside it so the two agree.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

function render(seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(() => useLearningAnalytics(), {
    persona: "free",
    seed,
  });
  cleanup = harness.cleanup;
  return harness;
}

/** A curriculum card with a review history. */
const aCard = (index: number, over: Record<string, unknown> = {}) =>
  aWordReview({
    id: reviewId(index),
    user_id: TEST_USER_ID,
    review_count: 10,
    correct_count: 8,
    last_reviewed_at: daysAgo(1),
    created_at: daysAgo(30),
    ...over,
  });

/** A saved word with a review history. */
const aSavedWord = (index: number, over: Record<string, unknown> = {}) =>
  aUserVocabulary({
    id: vocabId(index),
    user_id: TEST_USER_ID,
    review_count: 10,
    correct_count: 8,
    last_reviewed_at: daysAgo(1),
    created_at: daysAgo(30),
    ...over,
  });

const dayKey = (offsetDays: number) =>
  new Date(Date.now() - offsetDays * 86400_000).toISOString().split("T")[0];

const localDay = (offsetDays: number) => {
  const date = new Date(Date.now() - offsetDays * 86400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
};

describe("counting the deck", () => {
  it("counts both decks as one vocabulary", async () => {
    const { result } = render((backend) => {
      backend.db.seed("word_reviews", [aCard(0), aCard(1)]);
      backend.db.seed("user_vocabulary", [aSavedWord(0)]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A learner does not think of their curriculum progress and their saved
    // words as two collections.
    expect(result.current.data?.totalWords).toBe(3);
  });

  it("adds up every review across both", async () => {
    const { result } = render((backend) => {
      backend.db.seed("word_reviews", [aCard(0, { review_count: 10, correct_count: 9 })]);
      backend.db.seed("user_vocabulary", [aSavedWord(0, { review_count: 10, correct_count: 5 })]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalReviews).toBe(20);
    expect(result.current.data?.accuracy).toBe(70);
  });

  it("reports zero accuracy rather than a division by nothing", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [aCard(0, { review_count: 0, correct_count: 0 })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A brand-new learner opens this page, and NaN% would be the first thing
    // the app ever told them about themselves.
    expect(result.current.data?.accuracy).toBe(0);
  });

  it("leaves out another learner's cards", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [aCard(0), aCard(1, { user_id: "someone-else" })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalWords).toBe(1);
  });

  it("estimates study time from the review count", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [aCard(0, { review_count: 30 })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Half a minute a card. Rough on purpose — the app cannot see how long
    // somebody looked at a screen, and an invented precision would be a lie.
    expect(result.current.data?.studyMinutes).toBe(15);
  });
});

describe("the maturity breakdown", () => {
  it("sorts cards by their live SRS state, not a stored column", async () => {
    const { result } = render((backend) => {
      backend.db.seed("word_reviews", [
        aCard(0, { repetitions: 0, ease_factor: 0 }),
        aCard(1, { repetitions: 30, ease_factor: 400 }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const stages = result.current.data!.stageBreakdown;
    // Six buckets, always present, so the chart has a stable shape whatever the
    // learner's deck looks like.
    expect(stages.map((entry) => entry.stage)).toEqual([
      "New",
      "Learning",
      "Familiar",
      "Practiced",
      "Strong",
      "Mastered",
    ]);
    expect(stages.reduce((sum, entry) => sum + entry.count, 0)).toBe(2);
    // The chart moves for a word reviewed in the app, which is the whole point
    // of deriving it rather than reading the importer's column.
    expect(stages[0].count).toBe(1);
    expect(stages.at(-1)?.count).toBe(1);
  });

  it("splits the headline counts out of the same buckets", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [
        aCard(0, { repetitions: 0, ease_factor: 0 }),
        aCard(1, { repetitions: 30, ease_factor: 400 }),
        aCard(2, { repetitions: 3, ease_factor: 20 }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    // Learning is everything that is neither new nor mastered, so the three
    // headline numbers always sum to the deck.
    expect(data.newWords + data.learningWords + data.masteredWords).toBe(data.totalWords);
    expect(data.newWords).toBe(1);
    expect(data.masteredWords).toBe(1);
  });

  it("treats missing counters as the bottom of the ladder", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [aCard(0, { repetitions: null, ease_factor: null })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Columns added by later migrations are null on old rows; arithmetic on
    // null would put a NaN into the chart's domain and blank the whole thing.
    expect(result.current.data?.newWords).toBe(1);
  });
});

describe("the activity chart", () => {
  it("always covers the last fortnight", async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Fourteen points whether or not the learner studied, so a gap reads as a
    // day off rather than as missing data.
    expect(result.current.data?.dailyActivity).toHaveLength(14);
    expect(result.current.data?.dailyActivity.at(-1)?.date).toBe(dayKey(0));
  });

  it("counts a card against the day it was last reviewed", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [
        aCard(0, { last_reviewed_at: daysAgo(2) }),
        aCard(1, { last_reviewed_at: daysAgo(2) }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const day = result.current.data?.dailyActivity.find((entry) => entry.date === dayKey(2));
    expect(day).toMatchObject({ reviews: 2, correct: 2 });
  });

  it("ignores anything older than the window", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [aCard(0, { last_reviewed_at: daysAgo(60) })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      result.current.data?.dailyActivity.reduce((sum, entry) => sum + entry.reviews, 0),
    ).toBe(0);
  });

  it("ignores a card that has never been reviewed", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [aCard(0, { last_reviewed_at: null })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      result.current.data?.dailyActivity.reduce((sum, entry) => sum + entry.reviews, 0),
    ).toBe(0);
  });
});

describe("vocabulary growth", () => {
  it("accumulates words by the day they were added", async () => {
    const { result } = render((backend) =>
      backend.db.seed("user_vocabulary", [
        aSavedWord(0, { created_at: daysAgo(3) }),
        aSavedWord(1, { created_at: daysAgo(3) }),
        aSavedWord(2, { created_at: daysAgo(1) }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Cumulative, so the line only ever rises — which is the encouragement the
    // chart exists to give.
    expect(result.current.data?.vocabGrowth).toEqual([
      { date: dayKey(3), total: 2 },
      { date: dayKey(1), total: 3 },
    ]);
  });

  it("counts what was added in the last week", async () => {
    const { result } = render((backend) =>
      backend.db.seed("user_vocabulary", [
        aSavedWord(0, { created_at: daysAgo(2) }),
        aSavedWord(1, { created_at: daysAgo(30) }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.wordsLearnedThisWeek).toBe(1);
  });
});

describe("what the learner gets wrong", () => {
  it("ranks the worst-performing saved words", async () => {
    const { result } = render((backend) =>
      backend.db.seed("user_vocabulary", [
        aSavedWord(0, { word_arabic: "سهل", review_count: 10, correct_count: 9 }),
        aSavedWord(1, { word_arabic: "صعب", review_count: 10, correct_count: 2 }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Worst first: the list is a to-do, and burying the hardest word under nine
    // easier ones defeats it.
    expect(result.current.data?.topMistakes[0]).toMatchObject({
      word: "صعب",
      errorRate: 80,
    });
  });

  it("ignores a word seen only once", async () => {
    const { result } = render((backend) =>
      backend.db.seed("user_vocabulary", [
        aSavedWord(0, { word_arabic: "جديد", review_count: 1, correct_count: 0 }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // One miss is not a pattern, and calling a brand-new word the learner's
    // worst mistake is both wrong and discouraging.
    expect(result.current.data?.topMistakes).toEqual([]);
  });

  it("shows at most five", async () => {
    const { result } = render((backend) =>
      backend.db.seed(
        "user_vocabulary",
        Array.from({ length: 9 }, (_, index) =>
          aSavedWord(index, { word_arabic: `كلمة${index}`, review_count: 10, correct_count: index }),
        ),
      ),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.topMistakes).toHaveLength(5);
  });

  it("looks only at the learner's own saved words", async () => {
    const { result } = render((backend) => {
      backend.db.seed("word_reviews", [aCard(0, { review_count: 10, correct_count: 0 })]);
      backend.db.seed("user_vocabulary", []);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Pinned. Curriculum cards are excluded from this list — it reads
    // `user_vocabulary` alone — so a learner failing a curriculum word
    // repeatedly is never told about it here, even though that word counts
    // towards the accuracy figure directly above the chart.
    expect(result.current.data?.topMistakes).toEqual([]);
    expect(result.current.data?.accuracy).toBe(0);
  });
});

describe("the skill radar", () => {
  it("reads the four difficulty estimates", async () => {
    const { result } = render((backend) =>
      backend.db.seed("user_difficulty", [
        {
          user_id: TEST_USER_ID,
          vocab_difficulty: 0.8,
          listening_difficulty: 0.4,
          reading_difficulty: 0.6,
          speaking_difficulty: 0.2,
        },
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.skillRadar.slice(0, 4)).toEqual([
      { skill: "Vocabulary", value: 80 },
      { skill: "Listening", value: 40 },
      { skill: "Reading", value: 60 },
      { skill: "Speaking", value: 20 },
    ]);
  });

  it("sits every axis in the middle for a learner with no estimate yet", async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A radar collapsed to a point would read as "you are bad at everything" on
    // day one.
    expect(result.current.data?.skillRadar.slice(0, 4).map((axis) => axis.value)).toEqual([
      50, 50, 50, 50,
    ]);
  });

  it("caps the culture axis at full", async () => {
    const { result } = render((backend) =>
      backend.db.seed(
        "user_vocabulary",
        Array.from({ length: 300 }, (_, index) => aSavedWord(index)),
      ),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // It is derived from deck size against a 200-word target, so without the
    // cap a large deck would push the axis outside the chart.
    expect(result.current.data?.skillRadar.at(-1)).toMatchObject({
      skill: "Culture",
      value: 100,
    });
  });
});

describe("streaks and standing", () => {
  it("reports the review streak and the record", async () => {
    const { result } = render((backend) =>
      backend.db.seed("review_streaks", [
        { user_id: TEST_USER_ID, current_streak: 9, longest_streak: 40, last_review_date: localDay(0) },
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ currentStreak: 9, longestStreak: 40 });
  });

  it("reports XP and level", async () => {
    const { result } = render((backend) =>
      backend.db.seed("user_xp", [aUserXp({ user_id: TEST_USER_ID, total_xp: 4200, level: 7 })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ totalXP: 4200, level: 7 });
  });

  it("starts a learner with no XP row at level one", async () => {
    // The free persona ships an XP row; a brand-new account has none yet.
    const { result } = render((backend) => backend.db.seed("user_xp", []));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Level 0 is not a level anyone is on.
    expect(result.current.data).toMatchObject({ totalXP: 0, level: 1, currentStreak: 0 });
  });
});

describe("the daily-challenge streak", () => {
  const completions = (offsets: number[]) => (backend: SupabaseBackend) =>
    backend.db.seed(
      "daily_challenge_completions",
      offsets.map((offset, index) =>
        aChallengeCompletion({
          id: challengeCompletionId(index),
          user_id: TEST_USER_ID,
          challenge_date: localDay(offset),
        }),
      ),
    );

  it("counts consecutive days back from today", async () => {
    const { result } = render(completions([0, 1, 2]));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.challengeStreak).toBe(3);
    expect(result.current.data?.challengesCompleted).toBe(3);
  });

  it("keeps the streak alive before today's challenge is done", async () => {
    const { result } = render(completions([1, 2]));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A learner who studies in the evening opens the app at breakfast; telling
    // them their streak is zero is both wrong and the reason they would stop.
    expect(result.current.data?.challengeStreak).toBe(2);
  });

  it("stops at the first missed day", async () => {
    const { result } = render(completions([0, 1, 3, 4]));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.challengeStreak).toBe(2);
  });

  it("reports no streak once two days have been missed", async () => {
    const { result } = render(completions([2, 3]));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.challengeStreak).toBe(0);
    // Still counted for the lifetime total: the streak is broken, the work was
    // still done.
    expect(result.current.data?.challengesCompleted).toBe(2);
  });

  it("reports nothing for a learner who has never played", async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.challengeStreak).toBe(0);
  });
});

describe("when the data cannot be read", () => {
  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useLearningAnalytics(), {
      persona: "anonymous",
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });

  it("surfaces a failed curriculum read rather than a dashboard of zeros", async () => {
    const harness = renderHookWithProviders(() => useLearningAnalytics(), {
      persona: "free",
      seed: (backend) => backend.db.failAlways("word_reviews", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    // A dashboard of zeros tells a learner their work amounted to nothing,
    // which is the single most discouraging thing this page could say.
    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });

  it("surfaces a failed saved-words read too", async () => {
    const harness = renderHookWithProviders(() => useLearningAnalytics(), {
      persona: "free",
      seed: (backend) => backend.db.failAlways("user_vocabulary", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });

  it("still renders when only the peripheral reads fail", async () => {
    const { result } = render((backend) => {
      backend.db.seed("word_reviews", [aCard(0)]);
      backend.db.failAlways("review_streaks", 500, { message: "boom" });
      backend.db.failAlways("user_xp", 500, { message: "boom" });
      backend.db.failAlways("user_difficulty", 500, { message: "boom" });
      backend.db.failAlways("daily_challenge_completions", 500, { message: "boom" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The two word sources drive nearly every metric; the rest degrade to their
    // defaults rather than taking the page down with them.
    expect(result.current.data).toMatchObject({
      totalWords: 1,
      currentStreak: 0,
      level: 1,
      challengeStreak: 0,
    });
    expect(result.current.data?.skillRadar[0].value).toBe(50);
  });
});
