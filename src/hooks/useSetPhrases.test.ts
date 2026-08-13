import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import {
  aSetPhrase,
  aUserSetPhrase,
  daysAgo,
  setPhraseId,
  userSetPhraseId,
} from "@/test/support/factories";
import { useAuth } from "./useAuth";
import {
  useReviewPhrase,
  useSavePhrase,
  useSetPhraseOccasions,
  useSetPhrasesByOccasion,
  useUserSetPhrases,
  useUserSetPhrasesDueCount,
} from "./useSetPhrases";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Set phrases — the third SRS deck.
 *
 * Structurally different from the other two: a phrase belongs to a dialect, and
 * the learner's row points at it rather than carrying the dialect itself. So
 * the due count has to inner-join and filter on the *phrase's* dialect, and a
 * learner studying Gulf must not be shown Egyptian phrases they saved months
 * ago. That join is the only thing keeping the three modules apart here.
 *
 * The review path is an upsert on (user_id, phrase_id), which means the same
 * mutation both creates a card and reschedules one — so the branch where no row
 * exists yet has to seed sensible FSRS defaults rather than writing zeroes.
 */

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-03-11T12:00:00Z"));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

const anOccasion = (over: Record<string, unknown> = {}) => ({
  id: "occ-1",
  slug: "greetings",
  name: "Greetings",
  name_arabic: "تحيات",
  description: null,
  icon_name: "hand",
  display_order: 1,
  dialect: "Gulf",
  difficulty_floor: "A1",
  status: "published",
  ...over,
});

function render<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(hook, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

async function renderMutation<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(() => ({ hook: hook(), user: useAuth().user }), {
    persona: "free",
    seed,
  });
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.user).toBeTruthy());
  return harness;
}

describe("browsing the catalogue", () => {
  it("lists published occasions for the active dialect", async () => {
    const { result } = render(() => useSetPhraseOccasions(), (backend) => {
      backend.db.seed("set_phrase_occasions", [
        anOccasion({ name: "Greetings" }),
        anOccasion({ id: "occ-2", name: "Egyptian only", dialect: "Egyptian" }),
        anOccasion({ id: "occ-3", name: "Unfinished", status: "draft" }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].name).toBe("Greetings");
  });

  it("lists the phrases of one occasion", async () => {
    const { result } = render(() => useSetPhrasesByOccasion("occ-1"), (backend) => {
      backend.db.seed("set_phrases", [
        aSetPhrase({ id: setPhraseId(0), occasion_id: "occ-1", phrase_arabic: "صباح الخير" }),
        aSetPhrase({ id: setPhraseId(1), occasion_id: "occ-2", phrase_arabic: "غير" }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].phrase_arabic).toBe("صباح الخير");
  });

  it("asks nothing without an occasion", async () => {
    const { result, backend } = render(() => useSetPhrasesByOccasion(undefined), (b) =>
      b.db.seed("set_phrases", [aSetPhrase({ id: setPhraseId(0) })]),
    );

    // The occasion id comes from the route, so it is undefined on the first
    // render of every visit. The query is disabled rather than fetching and
    // discarding, which is why `data` stays undefined rather than becoming [].
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(backend.db.readsOf("set_phrases")).toHaveLength(0);
  });
});

describe("the learner's deck", () => {
  const seedDeck = (backend: SupabaseBackend) => {
    backend.db.seed("set_phrases", [
      aSetPhrase({ id: setPhraseId(0), dialect: "Gulf", phrase_arabic: "خليجي" }),
      aSetPhrase({ id: setPhraseId(1), dialect: "Egyptian", phrase_arabic: "مصري" }),
    ]);
    backend.db.seed("user_set_phrases", [
      aUserSetPhrase({
        id: userSetPhraseId(0),
        phrase_id: setPhraseId(0),
        next_review_at: daysAgo(1),
      }),
      aUserSetPhrase({
        id: userSetPhraseId(1),
        phrase_id: setPhraseId(1),
        next_review_at: daysAgo(1),
      }),
    ]);
  };

  it("returns each saved card with its phrase attached", async () => {
    const { result } = render(() => useUserSetPhrases(), seedDeck);

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    // The embed is what makes a card renderable at all; the learner's row holds
    // only scheduling and an id.
    expect(result.current.data?.[0]).toHaveProperty("set_phrases");
  });

  it("orders the deck by what is due first", async () => {
    const { result } = render(() => useUserSetPhrases(), (backend) => {
      seedDeck(backend);
      backend.db.seed("user_set_phrases", [
        aUserSetPhrase({
          id: userSetPhraseId(0),
          phrase_id: setPhraseId(0),
          next_review_at: daysAgo(-5),
        }),
        aUserSetPhrase({
          id: userSetPhraseId(1),
          phrase_id: setPhraseId(1),
          next_review_at: daysAgo(3),
        }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.[0].phrase_id).toBe(setPhraseId(1));
  });

  it("counts only phrases in the active dialect as due", async () => {
    const { result } = render(() => useUserSetPhrasesDueCount(), seedDeck);

    // Both cards are overdue, but only one is a Gulf phrase. The inner join on
    // set_phrases is the only thing keeping the three modules apart — without
    // it a Gulf learner is quizzed on Egyptian phrases they saved months ago.
    await waitFor(() => expect(result.current.data).toBe(1));
  });

  it("does not count a card that is not due yet", async () => {
    const { result } = render(() => useUserSetPhrasesDueCount(), (backend) => {
      seedDeck(backend);
      backend.db.seed("user_set_phrases", [
        aUserSetPhrase({
          id: userSetPhraseId(0),
          phrase_id: setPhraseId(0),
          next_review_at: daysAgo(-3),
        }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toBe(0));
  });

  it("counts nothing for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useUserSetPhrasesDueCount(), {
      seed: seedDeck,
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
    expect(harness.backend.db.readsOf("user_set_phrases")).toHaveLength(0);
  });
});

describe("saving a phrase", () => {
  it("adds it to the deck", async () => {
    const { result, backend } = await renderMutation(() => useSavePhrase(), (b) => {
      b.db.seed("set_phrases", [aSetPhrase({ id: setPhraseId(0) })]);
      b.db.seed("user_set_phrases", []);
    });

    await act(async () => {
      await result.current.hook.mutateAsync({ phraseId: setPhraseId(0) });
    });

    const saved = backend.db.rows("user_set_phrases")[0];
    expect(saved.user_id).toBe(TEST_USER_ID);
    expect(saved.phrase_id).toBe(setPhraseId(0));
    expect(saved.source).toBe("manual_save");
  });

  it("records where the save came from", async () => {
    const { result, backend } = await renderMutation(() => useSavePhrase(), (b) => {
      b.db.seed("set_phrases", [aSetPhrase({ id: setPhraseId(0) })]);
      b.db.seed("user_set_phrases", []);
    });

    await act(async () => {
      await result.current.hook.mutateAsync({ phraseId: setPhraseId(0), source: "quiz" });
    });

    expect(backend.db.rows("user_set_phrases")[0].source).toBe("quiz");
  });

  it("leaves an already-saved card's schedule alone", async () => {
    const { result, backend } = await renderMutation(() => useSavePhrase(), (b) => {
      b.db.seed("set_phrases", [aSetPhrase({ id: setPhraseId(0) })]);
      b.db.seed("user_set_phrases", [
        aUserSetPhrase({
          id: userSetPhraseId(0),
          phrase_id: setPhraseId(0),
          repetitions: 9,
          interval_days: 40,
        }),
      ]);
    });

    await act(async () => {
      await result.current.hook.mutateAsync({ phraseId: setPhraseId(0) });
    });

    // ignore-duplicates, not merge: re-saving a phrase from the catalogue must
    // not reset the review history the learner built on it.
    const rows = backend.db.rows("user_set_phrases");
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].repetitions)).toBe(9);
    expect(Number(rows[0].interval_days)).toBe(40);
  });
});

describe("reviewing a phrase", () => {
  const seedOne = (over: Record<string, unknown> = {}) => (backend: SupabaseBackend) => {
    backend.db.seed("set_phrases", [aSetPhrase({ id: setPhraseId(0) })]);
    backend.db.seed("user_set_phrases", [
      aUserSetPhrase({
        id: userSetPhraseId(0),
        phrase_id: setPhraseId(0),
        ease_factor: 5,
        difficulty: 5,
        interval_days: 3,
        repetitions: 2,
        last_reviewed_at: daysAgo(3),
        ...over,
      }),
    ]);
  };

  const reviewWith = async (quality: number, seed = seedOne()) => {
    const harness = await renderMutation(() => useReviewPhrase(), seed);
    await act(async () => {
      await harness.result.current.hook.mutateAsync({ phraseId: setPhraseId(0), quality });
    });
    return harness.backend.db.rows("user_set_phrases")[0];
  };

  it("pushes a remembered phrase further out", async () => {
    const row = await reviewWith(5);

    expect(Number(row.interval_days)).toBeGreaterThan(3);
    expect(Number(row.repetitions)).toBe(3);
    expect(new Date(String(row.next_review_at)).getTime()).toBeGreaterThan(Date.now());
  });

  it("brings a forgotten phrase back soon", async () => {
    const row = await reviewWith(1);

    // Quality below 3 maps to "again". A forgotten phrase scheduled weeks out
    // is a phrase the learner never relearns.
    expect(Number(row.interval_days)).toBeLessThanOrEqual(3);
  });

  it("schedules easy further out than good, and good further than hard", async () => {
    const hard = Number((await reviewWith(3)).interval_days);
    const good = Number((await reviewWith(4)).interval_days);
    const easy = Number((await reviewWith(5)).interval_days);

    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  it("never schedules a card for the same day", async () => {
    const row = await reviewWith(1);

    // Rounded up to at least one day; a zero-day interval puts the card back in
    // the same session and the learner never leaves it.
    expect(Number(row.interval_days)).toBeGreaterThanOrEqual(1);
  });

  it("records what the learner scored", async () => {
    const row = await reviewWith(4);

    expect(Number(row.last_quality)).toBe(4);
    expect(row.last_reviewed_at).toBeTruthy();
  });

  it("creates the card when the phrase was never saved", async () => {
    const row = await reviewWith(4, (backend) => {
      backend.db.seed("set_phrases", [aSetPhrase({ id: setPhraseId(0) })]);
      backend.db.seed("user_set_phrases", []);
    });

    // The same mutation both creates and reschedules, so a phrase quizzed
    // straight from the catalogue has to end up with a real schedule rather
    // than zeroes.
    expect(row.phrase_id).toBe(setPhraseId(0));
    expect(Number(row.repetitions)).toBeGreaterThan(0);
    expect(Number(row.interval_days)).toBeGreaterThanOrEqual(1);
    expect(row.source).toBe("reviewed");
  });

  it("keeps the original source when rescheduling", async () => {
    const row = await reviewWith(4, seedOne({ source: "quiz" }));

    // How a phrase entered the deck is a fact about the past; overwriting it on
    // every review would erase where the deck came from.
    expect(row.source).toBe("quiz");
  });

  it("does not create a second row for the same phrase", async () => {
    const harness = await renderMutation(() => useReviewPhrase(), seedOne());

    await act(async () => {
      await harness.result.current.hook.mutateAsync({ phraseId: setPhraseId(0), quality: 4 });
      await harness.result.current.hook.mutateAsync({ phraseId: setPhraseId(0), quality: 5 });
    });

    // Upserted on (user_id, phrase_id) — two rows would give one card two
    // competing schedules and show it twice in the deck.
    expect(harness.backend.db.rows("user_set_phrases")).toHaveLength(1);
  });

  it("refuses to review when signed out", async () => {
    const harness = renderHookWithProviders(() => useReviewPhrase(), {
      seed: (b) => b.db.seed("user_set_phrases", []),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await expect(
        harness.result.current.mutateAsync({ phraseId: setPhraseId(0), quality: 4 }),
      ).rejects.toThrow(/login required/i);
    });
  });
});
