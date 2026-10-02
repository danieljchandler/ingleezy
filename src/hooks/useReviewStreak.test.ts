import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aReviewStreak } from "@/test/support/factories";
import { localDateKey } from "@/lib/localDate";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useReviewStreak } from "./useReviewStreak";

/**
 * The streak on Today and on the clips feed.
 *
 * The feed's chip used to be a literal "0" — a number in the header that never
 * moved. This is the one place both surfaces read it from now, so the thing
 * worth pinning is that it comes from the learner's row, derived the same way
 * as everywhere else, and that the week strip agrees with the count.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(rows: Record<string, unknown>[]) {
  const seed = (backend: SupabaseBackend) => backend.db.seed("review_streaks", rows);
  const harness = renderHookWithProviders(() => useReviewStreak(), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("the learner's streak", () => {
  it("reads the run from the learner's row", async () => {
    const { result } = render([aReviewStreak({ current_streak: 4, last_review_date: localDateKey() })]);

    await waitFor(() => expect(result.current.days).toBe(4));
    // Four days ending today: the last four cells, and only those.
    expect(result.current.week.map((day) => day.done)).toEqual([false, false, false, true, true, true, true]);
  });

  it("is zero, with an empty week, for a learner with no row", async () => {
    const { result } = render([]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.days).toBe(0);
    expect(result.current.week.some((day) => day.done)).toBe(false);
  });

  it("does not trust a count whose run has already ended", async () => {
    const { result } = render([aReviewStreak({ current_streak: 9, last_review_date: "2020-01-01" })]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.days).toBe(0);
  });
});
