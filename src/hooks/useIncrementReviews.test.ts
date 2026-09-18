import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { TEST_USER_ID } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { utcWeekStart } from "@/lib/localDate";
import { useAuth } from "./useAuth";
import { useIncrementReviews } from "./useGamification";

/**
 * The bookkeeping every completed review triggers.
 *
 * Worth testing at the hook rather than the function, because the bug it fixes
 * was never in a function. `review_streaks` had six readers — the header pill
 * on every screen, the Majlis welcome, achievements, social, analytics and
 * notifications — and no writer anywhere in the app or the edge functions. The
 * streak was therefore zero for every learner, permanently, and the
 * `streak_days` achievement branch was unreachable. Nothing failed; a number
 * simply never moved, which is the kind of defect a unit test of a correct
 * function will never see.
 *
 * These run the real supabase-js client against the in-memory backend, so what
 * is asserted is the row the RPC actually leaves behind.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

/**
 * Render the hook and wait for the session to land before handing it back.
 *
 * `useAuth` resolves on a macrotask, and the mutation refuses outright when it
 * runs before the user is known — so a test that mutates on the first render
 * asserts nothing but its own race.
 */
async function render(seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(
    () => ({ record: useIncrementReviews(), auth: useAuth() }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.auth.user).not.toBeNull());
  return harness;
}

/** Run the mutation and wait for it to settle, failing loudly if it rejects. */
async function recordReview(
  harness: Awaited<ReturnType<typeof render>>,
): Promise<void> {
  await harness.result.current.record.mutateAsync();
}

/** Today, as the server's UTC date — what the RPC records when unprompted. */
const today = () => new Date().toISOString().slice(0, 10);

const dayOffset = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** The learner's streak row, or undefined when none was ever written. */
const streakRow = (backend: SupabaseBackend) =>
  backend.db.rows("review_streaks").find((row) => row.user_id === TEST_USER_ID);

const goalRow = (backend: SupabaseBackend) =>
  backend.db.rows("weekly_goals").find((row) => row.user_id === TEST_USER_ID);

describe("recording a completed review", () => {
  it("starts a streak on the first review of a learner's life", async () => {
    const harness = await render();
    const { backend } = harness;

    await recordReview(harness);

    expect(streakRow(backend)).toMatchObject({
      current_streak: 1,
      longest_streak: 1,
      last_review_date: today(),
    });
  });

  it("counts the day, not the review", async () => {
    // Two reviews in one sitting are one day of streak. Every review calls
    // this, so a streak that counted calls would read in the hundreds by the
    // end of a session.
    const harness = await render();
    const { backend } = harness;

    await recordReview(harness);
    await recordReview(harness);

    expect(goalRow(backend)?.completed_reviews).toBe(2);
    expect(streakRow(backend)?.current_streak).toBe(1);
  });

  it("extends the streak when the learner was here yesterday", async () => {
    const harness = await render((b) => {
      b.db.seed("review_streaks", [
        {
          user_id: TEST_USER_ID,
          current_streak: 4,
          longest_streak: 4,
          last_review_date: dayOffset(-1),
        },
      ]);
    });

    await recordReview(harness);

    expect(streakRow(harness.backend)?.current_streak).toBe(5);
    expect(streakRow(harness.backend)?.longest_streak).toBe(5);
  });

  it("restarts after a missed day but remembers the best run", async () => {
    const harness = await render((b) => {
      b.db.seed("review_streaks", [
        {
          user_id: TEST_USER_ID,
          current_streak: 12,
          longest_streak: 12,
          last_review_date: dayOffset(-4),
        },
      ]);
    });

    await recordReview(harness);

    expect(streakRow(harness.backend)?.current_streak).toBe(1);
    // The number the learner is proud of survives the miss. Resetting it too
    // would make one bad week erase a year.
    expect(streakRow(harness.backend)?.longest_streak).toBe(12);
  });

  it("counts the review toward this week's goal", async () => {
    const harness = await render();
    const { backend } = harness;

    await recordReview(harness);

    expect(goalRow(backend)).toMatchObject({
      week_start_date: utcWeekStart(),
      completed_reviews: 1,
    });
  });
});
