import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { aUserXp, aVocabularyWord, aWordReview, reviewId, wordId } from "@/test/support/factories";
import { all, enqueue as enqueueDirect } from "@/lib/reviewQueue";
import { useAuth } from "./useAuth";
import { useReviewQueue } from "./useReviewQueue";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The offline review queue.
 *
 * A rating goes to localStorage first and to the server second, so the UI can
 * advance immediately and a dropped connection cannot cost the learner work
 * they have already done. The consequence is that the two kinds of failure have
 * to be told apart: a network error is worth retrying with backoff, while a
 * rejected request is not — retrying that forever wedges the queue and blocks
 * every later rating behind it.
 *
 * None of this is visible in the UI beyond a pending count, which is exactly
 * why it needs tests. A queue that silently stops draining looks identical to
 * one that has finished.
 */

const NETWORK_ERROR = {
  code: "503",
  // isNetworkError classifies on the message; this is how a dropped fetch
  // actually presents.
  message: "Failed to fetch",
  details: null,
  hint: null,
};

const REJECTED = {
  code: "23514",
  message: "violates check constraint",
  details: null,
  hint: null,
};

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** One curriculum card with an existing review row, so a rating is an update. */
function seedCard(backend: SupabaseBackend) {
  backend.db.seed("vocabulary_words", [aVocabularyWord({ id: wordId(0) })]);
  backend.db.seed("word_reviews", [aWordReview({ id: reviewId(0), word_id: wordId(0) })]);
  backend.db.seed("user_xp", [aUserXp()]);
}

const snapshot = () => ({
  id: reviewId(0),
  ease_factor: 5,
  interval_days: 3,
  repetitions: 2,
  last_reviewed_at: null,
  next_review_at: new Date().toISOString(),
  lapses: 0,
});

/**
 * Render the hook and wait for the session to resolve.
 *
 * `enqueue` short-circuits when there is no user, and useAuth resolves a tick
 * after mount — so enqueueing immediately is a silent no-op that reads as a
 * queue that refuses to drain. The auth state is pulled in alongside purely so
 * there is something to wait on.
 */
async function renderQueue(seed: (backend: SupabaseBackend) => void = seedCard) {
  const harness = renderHookWithProviders(
    () => ({ ...useReviewQueue(), user: useAuth().user }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.user).toBeTruthy());
  return harness;
}

describe("submitting a rating", () => {
  it("writes it to the server", async () => {
    const { result, backend } = await renderQueue();

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    await waitFor(() => expect(backend.db.writesTo("word_reviews")).toHaveLength(1));
    const patch = backend.db.lastWriteTo("word_reviews")?.payload[0] ?? {};
    expect(Number(patch.repetitions)).toBe(3);
  });

  it("empties the queue once the server confirms", async () => {
    const { result } = await renderQueue();

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(all(TEST_USER_ID)).toHaveLength(0);
  });

  it("awards XP on the confirmed save, not on the click", async () => {
    const { result, backend } = await renderQueue();

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    // Paying out before the server has taken the rating would credit work the
    // learner might yet lose.
    await waitFor(() =>
      expect(Number(backend.db.rows("user_xp")[0]?.total_xp)).toBeGreaterThan(250),
    );
  });

  it("pays the amount the rating is worth", async () => {
    const { result, backend } = await renderQueue();

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "again", currentReview: snapshot() });
    });

    // "again" is 5, "good" is 15. Paying a flat rate would make forgetting as
    // profitable as remembering.
    await waitFor(() => expect(Number(backend.db.rows("user_xp")[0]?.total_xp)).toBe(255));
  });

  it("defaults an unspecified direction to recognition", async () => {
    const { result, backend } = await renderQueue();

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    await waitFor(() => expect(backend.db.writesTo("word_reviews")).toHaveLength(1));
    const patch = backend.db.lastWriteTo("word_reviews")?.payload[0] ?? {};
    // Writing a recognition rating into the production columns silently
    // corrupts a second, separate schedule for the same card. The one
    // production field a recognition rating does touch is
    // production_next_review_at, which is how remembering a word unlocks it for
    // production — so the scheduler columns are what distinguish the two.
    expect(patch).toHaveProperty("next_review_at");
    expect(patch).toHaveProperty("ease_factor");
    expect(patch).not.toHaveProperty("production_ease_factor");
    expect(patch).not.toHaveProperty("production_interval_days");
  });

  it("drains several ratings in the order they were given", async () => {
    const { result, backend } = await renderQueue((b) => {
      seedCard(b);
      b.db.add("vocabulary_words", aVocabularyWord({ id: wordId(1) }));
      b.db.add("word_reviews", aWordReview({ id: reviewId(1), word_id: wordId(1) }));
    });

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
      result.current.enqueue({
        wordId: wordId(1),
        rating: "easy",
        currentReview: { ...snapshot(), id: reviewId(1) },
      });
    });

    await waitFor(() => expect(backend.db.writesTo("word_reviews")).toHaveLength(2));
    expect(result.current.pendingCount).toBe(0);
  });

  it("does nothing for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useReviewQueue(), { seed: seedCard });
    cleanup = harness.cleanup;

    await act(async () => {
      harness.result.current.enqueue({
        wordId: wordId(0),
        rating: "good",
        currentReview: snapshot(),
      });
    });

    // There is no schedule to write to, and queueing under an anonymous key
    // would strand the rating where no session could ever flush it.
    expect(harness.result.current.pendingCount).toBe(0);
    expect(harness.backend.db.writesTo("word_reviews")).toHaveLength(0);
  });
});

describe("when the connection drops", () => {
  it("holds the rating rather than losing it", async () => {
    const { result, backend } = await renderQueue();
    backend.db.failWrites("word_reviews", 503, NETWORK_ERROR);

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    // Still on disk, so a reload or a crash cannot drop it.
    expect(all(TEST_USER_ID)).toHaveLength(1);
  });

  it("counts the attempt, so the backoff grows", async () => {
    const { result, backend } = await renderQueue();
    backend.db.failWrites("word_reviews", 503, NETWORK_ERROR);

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    await waitFor(() => expect(all(TEST_USER_ID)[0]?.attempts).toBeGreaterThanOrEqual(1));
  });

  it("retries after the backoff and lands the rating", async () => {
    const { result, backend } = await renderQueue();
    // Fail once, so the retry has something to succeed at.
    backend.db.failNextWrite("word_reviews", 503, NETWORK_ERROR);

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    // Backoff starts at 1s. Asserted on the outcome rather than on the
    // intermediate attempt count: the retry is scheduled on a real timer, so
    // observing the mid-flight state is a race the test would sometimes lose.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    await waitFor(() => expect(backend.db.writesTo("word_reviews")).toHaveLength(1));
    expect(all(TEST_USER_ID)).toHaveLength(0);
    expect(result.current.pendingCount).toBe(0);
  });

  it("awards no XP for a rating the server has not taken", async () => {
    const { result, backend } = await renderQueue();
    backend.db.failWrites("word_reviews", 503, NETWORK_ERROR);

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    expect(Number(backend.db.rows("user_xp")[0]?.total_xp)).toBe(250);
  });

  it("holds the rest of the queue behind the one that failed", async () => {
    const { result, backend } = await renderQueue((b) => {
      seedCard(b);
      b.db.add("vocabulary_words", aVocabularyWord({ id: wordId(1) }));
      b.db.add("word_reviews", aWordReview({ id: reviewId(1), word_id: wordId(1) }));
    });
    backend.db.failWrites("word_reviews", 503, NETWORK_ERROR);

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
      result.current.enqueue({
        wordId: wordId(1),
        rating: "good",
        currentReview: { ...snapshot(), id: reviewId(1) },
      });
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(2));
    // Order is the point: skipping ahead would apply a later rating of the same
    // card before an earlier one.
    expect(all(TEST_USER_ID).map((item) => item.wordId)).toEqual([wordId(0), wordId(1)]);
  });

  it("flushes again as soon as the browser comes back online", async () => {
    const { result, backend } = await renderQueue();
    backend.db.failWrites("word_reviews", 503, NETWORK_ERROR);

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    backend.db.clearFailure("word_reviews");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    // Waiting out a 60s backoff after the connection is demonstrably back would
    // leave the learner staring at a stale pending count.
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(backend.db.writesTo("word_reviews")).toHaveLength(1);
  });

  it("reports being offline", async () => {
    const { result } = await renderQueue();

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.isOnline).toBe(false);
  });
});

describe("when the server rejects the rating outright", () => {
  it("drops it rather than retrying forever", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, backend } = await renderQueue();
    backend.db.failWrites("word_reviews", 400, REJECTED);

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    // A constraint violation will fail identically forever; keeping it would
    // wedge the queue and block every later rating behind it.
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(all(TEST_USER_ID)).toHaveLength(0);
  });

  it("says so, rather than dropping it silently", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, backend } = await renderQueue();
    backend.db.failWrites("word_reviews", 400, REJECTED);

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
    });

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        "Review submit failed permanently:",
        expect.anything(),
      ),
    );
  });

  it("keeps draining the ratings behind it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, backend } = await renderQueue((b) => {
      seedCard(b);
      b.db.add("vocabulary_words", aVocabularyWord({ id: wordId(1) }));
      b.db.add("word_reviews", aWordReview({ id: reviewId(1), word_id: wordId(1) }));
    });
    backend.db.failNextWrite("word_reviews", 400, REJECTED);

    act(() => {
      result.current.enqueue({ wordId: wordId(0), rating: "good", currentReview: snapshot() });
      result.current.enqueue({
        wordId: wordId(1),
        rating: "good",
        currentReview: { ...snapshot(), id: reviewId(1) },
      });
    });

    // One bad rating must not cost the learner the ones after it.
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(backend.db.writesTo("word_reviews")).toHaveLength(1);
  });
});

describe("a queue left over from a previous visit", () => {
  it("drains on mount", async () => {
    enqueueDirect(TEST_USER_ID, {
      wordId: wordId(0),
      rating: "good",
      currentReview: snapshot(),
      direction: "recognition",
    });

    const { result, backend } = await renderQueue();

    // The learner closed the tab mid-flush. Nothing else will ever retry this,
    // so mounting has to.
    await waitFor(() => expect(backend.db.writesTo("word_reviews")).toHaveLength(1));
    expect(result.current.pendingCount).toBe(0);
  });

  it("treats an entry with no direction as recognition", async () => {
    // Queued before directions existed. Guessing wrong here writes the rating
    // into the wrong column set and corrupts the card's schedule.
    enqueueDirect(TEST_USER_ID, {
      wordId: wordId(0),
      rating: "good",
      currentReview: snapshot(),
    } as never);

    const { backend } = await renderQueue();

    await waitFor(() => expect(backend.db.writesTo("word_reviews")).toHaveLength(1));
    const patch = backend.db.lastWriteTo("word_reviews")?.payload[0] ?? {};
    expect(patch).toHaveProperty("ease_factor");
    expect(patch).not.toHaveProperty("production_ease_factor");
  });

  it("ignores another learner's leftovers", async () => {
    enqueueDirect("00000000-0000-4000-8000-000000000009", {
      wordId: wordId(0),
      rating: "good",
      currentReview: snapshot(),
      direction: "recognition",
    });

    const { result, backend } = await renderQueue();

    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(backend.db.writesTo("word_reviews")).toHaveLength(0);
  });
});
