import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aReviewStreak, TEST_USER_ID } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useAuth } from "./useAuth";
import { useSubmitReview } from "./useReview";

/**
 * The review that earns a streak badge has to earn it on that review.
 *
 * `useCheckAchievements` decides a `streak_days` badge by reading
 * `review_streaks`, and `useIncrementReviews` is what writes that row. Both
 * used to be fired together at the end of a rating, so on the one review that
 * crosses a threshold the check could read the streak as it stood *before* —
 * and silently skip an award the learner had just earned. It would then appear
 * on their next review, attributed to nothing, or not at all if they stopped
 * there.
 *
 * Nothing failed when that happened, which is what made it worth a test rather
 * than a comment: the only visible symptom is a badge that does not appear.
 */

const WORD = "11111111-0000-4000-8000-000000000000";
const ACHIEVEMENT = "22222222-0000-4000-8000-000000000000";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const yesterday = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

/** A learner one day short of a two-day streak badge. */
function seedOneShortOfTheBadge(backend: SupabaseBackend) {
  backend.db.seed("achievements", [
    {
      id: ACHIEVEMENT,
      name: "Two days running",
      name_arabic: "يومان متتاليان",
      description: "Reviewed two days in a row",
      icon: "🔥",
      xp_reward: 50,
      requirement_type: "streak_days",
      requirement_value: 2,
      display_order: 1,
    },
  ]);
  backend.db.seed("user_achievements", []);

  // Reviewed yesterday and not yet today: the rating below takes them to two.
  backend.db.seed("review_streaks", [
    aReviewStreak({ user_id: TEST_USER_ID, current_streak: 1, last_review_date: yesterday() }),
  ]);
}

describe("earning a streak badge", () => {
  it("grants it on the review that earns it, not the one after", async () => {
    const harness = renderHookWithProviders(
      () => ({ submit: useSubmitReview(), auth: useAuth() }),
      { persona: "free", seed: seedOneShortOfTheBadge },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.auth.user).not.toBeNull());

    await harness.result.current.submit.mutateAsync({
      wordId: WORD,
      rating: "good",
      currentReview: null,
    });

    // The streak reached two on this rating...
    await waitFor(() =>
      expect(
        harness.backend.db.rows("review_streaks").find((row) => row.user_id === TEST_USER_ID)
          ?.current_streak,
      ).toBe(2),
    );

    // ...and the badge for two is on their profile, awarded by the same review
    // rather than deferred to whenever they next happen to open a deck.
    await waitFor(() =>
      expect(
        harness.backend.db
          .rows("user_achievements")
          .filter((row) => row.user_id === TEST_USER_ID && row.achievement_id === ACHIEVEMENT),
      ).toHaveLength(1),
    );
  });
});
