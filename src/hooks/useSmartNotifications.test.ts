import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aUserVocabulary,
  aUserXp,
  aVocabBattle,
  aWordReview,
  battleId,
  daysAgo,
  daysFromNow,
  reviewId,
  TEST_USER_ID,
  vocabId,
} from "@/test/support/factories";
import { useSmartNotifications } from "./useSmartNotifications";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Everything the app has to say to a learner, assembled in one place.
 *
 * Five signals feed it — reviews falling due, a streak about to break, a battle
 * waiting, unread coaching, and the Monday summary — and they are gathered
 * together rather than each shouting for itself. That is the point: five badges
 * competing for attention is noise, and a learner who learns to dismiss the
 * bell stops seeing the one message that mattered.
 *
 * So the ordering is the feature. High priority is reserved for things that
 * expire: a streak dies at midnight whether or not anyone reads about it.
 */

let cleanup: (() => void) | undefined;

/**
 * A Wednesday. The Monday summary is one of the notifications this hook
 * produces, so a suite left on the real clock quietly gains an extra
 * notification one day in seven — which is how these tests first failed.
 */
const A_WEDNESDAY = new Date("2026-08-12T09:00:00");

beforeEach(() => {
  vi.useRealTimers();
  vi.setSystemTime(A_WEDNESDAY);
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

function render(seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(() => useSmartNotifications(), {
    persona: "free",
    seed,
  });
  cleanup = harness.cleanup;
  return harness;
}

const ids = (list: Array<{ id: string }> | undefined) => (list ?? []).map((item) => item.id);

/** Freeze the clock at a given hour today, so the streak window is decidable. */
const at = (hour: number) => {
  const when = new Date();
  when.setHours(hour, 0, 0, 0);
  vi.setSystemTime(when);
};

/** Today's date as the `review_streaks` date-only column stores it. */
const localDay = (offsetDays: number) => {
  const date = new Date(Date.now() - offsetDays * 86400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
};

const dueCards = (count: number) => (backend: SupabaseBackend) =>
  backend.db.seed(
    "word_reviews",
    Array.from({ length: count }, (_, index) =>
      aWordReview({ id: reviewId(index), user_id: TEST_USER_ID, next_review_at: daysAgo(1) }),
    ),
  );

describe("nothing to say", () => {
  it("returns an empty list for a learner who is up to date", async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Silence is the correct output most of the time, and a bell that is always
    // lit is a bell nobody reads.
    expect(result.current.data).toEqual([]);
  });

  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useSmartNotifications(), {
      persona: "anonymous",
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });
});

describe("reviews falling due", () => {
  it("counts both decks together", async () => {
    const { result } = render((backend) => {
      dueCards(2)(backend);
      backend.db.seed("user_vocabulary", [
        aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, next_review_at: daysAgo(1) }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A learner thinks in one number, not "two curriculum plus one saved".
    expect(result.current.data?.[0]).toMatchObject({
      id: "review-due",
      title: "3 كلمات مستحقة للمراجعة",
      actionUrl: "/review",
    });
  });

  it("says nothing when nothing is due yet", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [
        aWordReview({ user_id: TEST_USER_ID, next_review_at: daysFromNow(3) }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).not.toContain("review-due");
  });

  it("leaves out another learner's cards", async () => {
    const { result } = render((backend) =>
      backend.db.seed("word_reviews", [
        aWordReview({ id: reviewId(0), user_id: "someone-else", next_review_at: daysAgo(1) }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("gets more urgent as the backlog grows", async () => {
    const small = render(dueCards(5));
    await waitFor(() => expect(small.result.current.isSuccess).toBe(true));
    expect(small.result.current.data?.[0].priority).toBe("medium");
    small.cleanup();

    const large = render(dueCards(25));
    cleanup = large.cleanup;
    await waitFor(() => expect(large.result.current.isSuccess).toBe(true));
    // Twenty-plus is where a session stops being a few minutes, and where a
    // learner is most likely to skip it and let the backlog compound.
    expect(large.result.current.data?.[0].priority).toBe("high");
  });

  it("changes what it says once the pile is worth worrying about", async () => {
    const small = render(dueCards(3));
    await waitFor(() => expect(small.result.current.isSuccess).toBe(true));
    expect(small.result.current.data?.[0].body).toContain("جلسة مراجعة سريعة");
    small.cleanup();

    const large = render(dueCards(12));
    cleanup = large.cleanup;
    await waitFor(() => expect(large.result.current.isSuccess).toBe(true));
    expect(large.result.current.data?.[0].body).toContain("لا تخلّها تفوتك");
  });
});

describe("a streak about to break", () => {
  const withStreak = (streak: number, lastReviewDate: string | null) => (backend: SupabaseBackend) =>
    backend.db.seed("review_streaks", [
      {
        user_id: TEST_USER_ID,
        current_streak: streak,
        longest_streak: streak,
        last_review_date: lastReviewDate,
      },
    ]);

  it("warns when yesterday's review was the last one", async () => {
    const { result } = render(withStreak(12, localDay(1)));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The one notification with a deadline attached: it stops being true at
    // midnight whether or not anybody read it.
    expect(result.current.data?.[0]).toMatchObject({
      id: "streak-risk",
      title: "سلسلة 12 يوم في خطر!",
      priority: "high",
    });
  });

  it("says nothing in the morning to a learner who has already reviewed today", async () => {
    at(10);
    const { result } = render(withStreak(12, localDay(0)));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Nagging somebody who has just done the thing is the fastest way to teach
    // them to ignore the bell.
    expect(ids(result.current.data)).not.toContain("streak-risk");
  });

  it("warns them anyway once it gets late", async () => {
    at(21);
    const { result } = render(withStreak(12, localDay(0)));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Pinned. `last_review_date` is a date with no time, so the window is
    // measured from midnight of the day the learner reviewed rather than from
    // the review itself. Anyone who studies in the morning is told their streak
    // is at risk that same evening — twenty hours after a midnight they have
    // already reviewed past. The one high-priority notification the app has is
    // the one most likely to be wrong.
    expect(ids(result.current.data)).toContain("streak-risk");
  });

  it("says nothing once the streak is already gone", async () => {
    const { result } = render(withStreak(12, localDay(3)));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Past 48 hours it is not at risk, it is broken, and "keep your streak
    // alive" would be untrue.
    expect(ids(result.current.data)).not.toContain("streak-risk");
  });

  it("says nothing to a learner with no streak to lose", async () => {
    const { result } = render(withStreak(0, localDay(1)));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).not.toContain("streak-risk");
  });

  it("says nothing when there is no last review recorded", async () => {
    const { result } = render(withStreak(5, null));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).not.toContain("streak-risk");
  });

  it("measures the window in the learner's own day", async () => {
    const { result } = render(withStreak(7, localDay(1)));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The column is a date with no time, and reading it as UTC midnight shifts
    // the whole window by the learner's offset — up to half a day for Gulf
    // learners, which is the difference between a warning and a broken streak.
    expect(ids(result.current.data)).toContain("streak-risk");
  });
});

describe("a battle waiting", () => {
  const withBattles = (count: number) => (backend: SupabaseBackend) =>
    backend.db.seed(
      "vocab_battles",
      Array.from({ length: count }, (_, index) =>
        aVocabBattle({
          id: battleId(index),
          challenger_id: "someone-else",
          opponent_id: TEST_USER_ID,
          status: "pending",
          opponent_score: null,
        }),
      ),
    );

  it("counts the challenges the learner has not answered", async () => {
    const { result } = render(withBattles(1));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({
      id: "battle-invite",
      title: "تحدي كلمات ينتظرك",
      actionUrl: "/battles",
    });
  });

  it("pluralises when there is more than one", async () => {
    const { result } = render(withBattles(3));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].title).toBe("3 تحديات كلمات تنتظرك");
  });

  it("ignores battles the learner already played", async () => {
    const { result } = render((backend) =>
      backend.db.seed("vocab_battles", [
        aVocabBattle({
          id: battleId(0),
          challenger_id: "someone-else",
          opponent_id: TEST_USER_ID,
          status: "pending",
          opponent_score: 8,
        }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Their opponent is the one waiting now.
    expect(ids(result.current.data)).not.toContain("battle-invite");
  });

  it("ignores battles the learner issued", async () => {
    const { result } = render((backend) =>
      backend.db.seed("vocab_battles", [
        aVocabBattle({
          id: battleId(0),
          challenger_id: TEST_USER_ID,
          opponent_id: "someone-else",
          status: "pending",
        }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).not.toContain("battle-invite");
  });
});

describe("unread coaching", () => {
  const aRecommendation = (over: Record<string, unknown> = {}) => ({
    id: "rec-1",
    user_id: TEST_USER_ID,
    week_start: localDay(7),
    viewed_at: null,
    motivation_message: "Your production is catching up to your recognition.",
    focus_areas: [],
    performance_summary: {},
    suggested_content: [],
    vocab_to_review: [],
    created_at: daysAgo(1),
    ...over,
  });

  it("surfaces a recommendation nobody has opened", async () => {
    const { result } = render((backend) =>
      backend.db.seed("weekly_recommendations", [aRecommendation()]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({
      id: "coach-advice",
      priority: "low",
      body: "Your production is catching up to your recognition.",
    });
  });

  it("says nothing once it has been read", async () => {
    const { result } = render((backend) =>
      backend.db.seed("weekly_recommendations", [aRecommendation({ viewed_at: daysAgo(1) })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).not.toContain("coach-advice");
  });

  it("looks only at the most recent one", async () => {
    const { result } = render((backend) =>
      backend.db.seed("weekly_recommendations", [
        aRecommendation({ id: "old", viewed_at: null, created_at: daysAgo(30) }),
        aRecommendation({ id: "new", viewed_at: daysAgo(1), created_at: daysAgo(1) }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A recommendation from a month ago is not advice any more, and the read
    // state of the current week is the only one worth acting on.
    expect(ids(result.current.data)).not.toContain("coach-advice");
  });

  it("falls back to a generic line when the coach wrote none", async () => {
    const { result } = render((backend) =>
      backend.db.seed("weekly_recommendations", [aRecommendation({ motivation_message: null })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].body).toContain("نصائح مخصّصة");
  });
});

describe("ordering what it has to say", () => {
  it("puts the thing that expires first", async () => {
    const { result } = render((backend) => {
      dueCards(3)(backend);
      backend.db.seed("review_streaks", [
        {
          user_id: TEST_USER_ID,
          current_streak: 9,
          longest_streak: 9,
          last_review_date: localDay(1),
        },
      ]);
      backend.db.seed("weekly_recommendations", [
        {
          id: "rec-1",
          user_id: TEST_USER_ID,
          week_start: localDay(7),
          viewed_at: null,
          motivation_message: "Keep going.",
          focus_areas: [],
          performance_summary: {},
          suggested_content: [],
          vocab_to_review: [],
          created_at: daysAgo(1),
        },
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // High before medium before low. The streak dies tonight; the reviews will
    // still be there tomorrow; the coaching will keep.
    expect(ids(result.current.data)).toEqual(["streak-risk", "review-due", "coach-advice"]);
  });

  it("keeps the Monday summary for Mondays", async () => {
    const monday = new Date();
    monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    vi.setSystemTime(monday);

    const { result } = render((backend) =>
      backend.db.seed("user_xp", [aUserXp({ user_id: TEST_USER_ID, xp_this_week: 340 })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A weekly summary on a Wednesday is about a week that is half over.
    expect(result.current.data?.[0]).toMatchObject({ id: "weekly-summary", priority: "low" });
    expect(result.current.data?.[0].body).toContain("340 نقطة");
  });

  it("encourages a learner who earned nothing last week", async () => {
    const monday = new Date();
    monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    vi.setSystemTime(monday);

    const { result } = render((backend) =>
      backend.db.seed("user_xp", [aUserXp({ user_id: TEST_USER_ID, xp_this_week: 0 })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // "جمعت 0 نقطة الأسبوع الماضي" is a true sentence that makes people quit.
    expect(result.current.data?.[0].body).toContain("ابدأ الأسبوع بقوة");
  });

  it("says nothing on any other day", async () => {
    const wednesday = new Date();
    wednesday.setDate(wednesday.getDate() + ((10 - wednesday.getDay()) % 7 || 7));
    vi.setSystemTime(wednesday);

    const { result } = render((backend) =>
      backend.db.seed("user_xp", [aUserXp({ user_id: TEST_USER_ID, xp_this_week: 340 })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids(result.current.data)).not.toContain("weekly-summary");
  });
});
