import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import {
  useClaimNewCard,
  useNewCardsToday,
  useRemainingNewCardBudget,
} from "./useNewCardBudget";

/**
 * The daily new-card budget.
 *
 * Introducing too many new cards in one sitting is the classic way a learner
 * buries themselves — the reviews arrive days later, all at once, and they quit.
 * The cap only works if it is a real daily limit, so the counter lives on the
 * server and is shared by both review paths (curriculum `word_reviews` and
 * personal `user_vocabulary`). A per-page-load counter, or one kept per deck,
 * would let a learner reset it by reloading or by switching decks.
 *
 * The counter is keyed by UTC date, so these tests freeze the clock rather than
 * letting a run that straddles midnight decide the answer.
 */

let cleanup: (() => void) | undefined;

const TODAY = "2026-03-11";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

const aCount = (over: Record<string, unknown> = {}) => ({
  user_id: TEST_USER_ID,
  day: TODAY,
  count: 0,
  ...over,
});

describe("how many new cards were studied today", () => {
  it("reads the learner's row for today", async () => {
    const harness = renderHookWithProviders(() => useNewCardsToday(), {
      persona: "free",
      seed: (backend) => backend.db.seed("daily_new_card_counts", [aCount({ count: 7 })]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.data).toBe(7));
  });

  it("reports zero when the learner has not started today", async () => {
    const harness = renderHookWithProviders(() => useNewCardsToday(), {
      persona: "free",
      seed: (backend) => backend.db.seed("daily_new_card_counts", []),
    });
    cleanup = harness.cleanup;

    // No row is the normal state at the start of a day, not an error.
    await waitFor(() => expect(harness.result.current.data).toBe(0));
  });

  it("ignores yesterday's count", async () => {
    const harness = renderHookWithProviders(() => useNewCardsToday(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("daily_new_card_counts", [aCount({ day: "2026-03-10", count: 40 })]),
    });
    cleanup = harness.cleanup;

    // The cap resets at midnight; carrying yesterday's number over would lock a
    // learner out of a day they have not begun.
    await waitFor(() => expect(harness.result.current.data).toBe(0));
  });

  it("ignores another learner's count", async () => {
    const harness = renderHookWithProviders(() => useNewCardsToday(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("daily_new_card_counts", [
          aCount({ user_id: "00000000-0000-4000-8000-000000000009", count: 40 }),
        ]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.data).toBe(0));
  });

  it("asks nothing for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useNewCardsToday(), {
      seed: (backend) => backend.db.seed("daily_new_card_counts", [aCount({ count: 7 })]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
    expect(harness.backend.db.readsOf("daily_new_card_counts")).toHaveLength(0);
  });
});

describe("how much budget is left", () => {
  const budget = async (cap: number, count: number) => {
    const harness = renderHookWithProviders(() => useRemainingNewCardBudget(cap), {
      persona: "free",
      seed: (backend) => backend.db.seed("daily_new_card_counts", [aCount({ count })]),
    });
    cleanup = harness.cleanup;
    // `isLoading` is not a readiness signal here. The query is `enabled: !!user`,
    // and while `useAuth` is still resolving it sits disabled — pending but not
    // fetching, which TanStack reports as isLoading **false**. Waiting on that
    // alone returns during the disabled window and reads a count of zero, which
    // is how this passed locally and failed on a slower CI runner. Wait for the
    // query to have actually run first.
    await waitFor(() =>
      expect(harness.backend.db.readsOf("daily_new_card_counts").length).toBeGreaterThan(0),
    );
    await waitFor(() => expect(harness.result.current.isLoading).toBe(false));
    return harness.result;
  };

  it("subtracts what has been studied from the cap", async () => {
    const result = await budget(20, 8);

    expect(result.current.remaining).toBe(12);
    expect(result.current.countToday).toBe(8);
  });

  it("reports nothing left once the cap is reached", async () => {
    const result = await budget(20, 20);

    expect(result.current.remaining).toBe(0);
  });

  it("never reports a negative budget", async () => {
    // The cap is a setting the learner can lower mid-day, which can leave the
    // count above it. A negative number here would be compared as "> 0" by
    // callers and read as budget available.
    const result = await budget(10, 25);

    expect(result.current.remaining).toBe(0);
  });

  it("reports a full budget, and not loading, before the session resolves", async () => {
    const harness = renderHookWithProviders(() => useRemainingNewCardBudget(20), {
      persona: "free",
      seed: (backend) => backend.db.seed("daily_new_card_counts", [aCount({ count: 20 })]),
    });
    cleanup = harness.cleanup;

    // Recording current behaviour, and a sharp edge. The query is `enabled:
    // !!user`, and a disabled react-query query reports `isLoading: false` —
    // so during the tick before useAuth resolves, a caller sees "not loading"
    // next to the full cap. Waiting on the flag is therefore not enough to
    // avoid handing a learner budget they have already spent; a caller has to
    // wait for the count itself.
    expect(harness.result.current.isLoading).toBe(false);
    expect(harness.result.current.remaining).toBe(20);

    // It does settle on the truth.
    await waitFor(() => expect(harness.result.current.remaining).toBe(0));
  });
});

describe("claiming a card against the budget", () => {
  it("increments the server counter", async () => {
    const harness = renderHookWithProviders(() => useClaimNewCard(), {
      persona: "free",
      seed: (backend) => backend.db.seed("daily_new_card_counts", [aCount({ count: 3 })]),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await harness.result.current.mutateAsync();
    });

    // Server-side, so two devices in the same day share one budget.
    expect(Number(harness.backend.db.rows("daily_new_card_counts")[0].count)).toBe(4);
  });

  it("starts the day's row when there is none", async () => {
    const harness = renderHookWithProviders(() => useClaimNewCard(), {
      persona: "free",
      seed: (backend) => backend.db.seed("daily_new_card_counts", []),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await harness.result.current.mutateAsync();
    });

    const rows = harness.backend.db.rows("daily_new_card_counts");
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].count)).toBe(1);
    expect(rows[0].day).toBe(TODAY);
  });

  it("surfaces a failure rather than swallowing it", async () => {
    const harness = renderHookWithProviders(() => useClaimNewCard(), {
      persona: "free",
      seed: (backend) =>
        backend.stubRpc("increment_new_card_count", () => {
          throw new Error("counter unavailable");
        }),
    });
    cleanup = harness.cleanup;

    // A silent failure means the cap stops counting and the learner is handed
    // an unlimited day without either of them knowing.
    // Asserted inside `act` rather than around it: a rejection escaping the act
    // scope leaves React's internal queue flagged, and the next test in the
    // file renders a tree whose result is null.
    await act(async () => {
      await expect(harness.result.current.mutateAsync()).rejects.toThrow();
    });
  });
});
