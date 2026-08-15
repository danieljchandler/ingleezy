import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aUserVocabulary, TEST_USER_ID } from "@/test/support/factories";
import { useSiblingWords } from "./useSiblingWords";
import { useRootIndex } from "./useRootIndex";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Words in the learner's deck sharing a word family with the card in front of
 * them.
 *
 * This began as Arabic root morphology and the teaching move survived the flip
 * intact: act, action, active and actor are one family, and seeing them
 * together during review turns four unrelated memorisations into one pattern.
 * Surfacing the wrong siblings is worse than surfacing none — a false
 * connection is harder to unlearn than no connection.
 *
 * So the selection is narrow on purpose: same learner, same dialect, same
 * family, never the card itself.
 *
 * Two of those were broken for as long as the feature has shipped, and the
 * tests that cover them are the point of this file:
 *
 * - **Family spelling.** The column holds free text written by whichever AI
 *   path saved the card — "Act" from one, "act" from another, " ACT " from a
 *   third. SQL equality made those three strangers.
 * - **Dialect.** The comparison is against the *card's* dialect. Passing the
 *   app's active dialect instead means a mixed-dialect session matches Yemeni
 *   cards against Gulf siblings.
 *
 * `stage` is deliberately absent throughout: no migration creates that column,
 * only the Anki importer ever wrote it, and it sorted alphabetically. Mastery
 * order comes from FSRS stability in `ease_factor`.
 */

const ROOT = "act";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const aWord = (index: number, over: Record<string, unknown> = {}) =>
  aUserVocabulary({
    id: `voc-${index}`,
    user_id: TEST_USER_ID,
    word_arabic: `كلمة${index}`,
    word_english: `word ${index}`,
    root: ROOT,
    dialect: "Gulf",
    ...over,
  });

function render(
  params: {
    root?: string | null;
    excludeId?: string;
    dialect?: string;
    limit?: number;
    enabled?: boolean;
  },
  rows: Record<string, unknown>[] = [],
) {
  const seed = (backend: SupabaseBackend) => backend.db.seed("user_vocabulary", rows);
  const harness = renderHookWithProviders(
    () => ({
      // The index is rendered alongside so a test can wait for the fetch it
      // depends on. Same query key, so react-query serves both from one request.
      index: useRootIndex(),
      hook: useSiblingWords({
        root: params.root === undefined ? ROOT : params.root,
        excludeId: params.excludeId ?? "voc-0",
        dialect: params.dialect ?? "Gulf",
        limit: params.limit,
        enabled: params.enabled,
      }),
    }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  return harness;
}

/**
 * Wait for the deck to actually be loaded.
 *
 * Waiting on the selector's own `isLoading` is not enough: it reports false
 * before the session resolves, so an assertion could run against an index that
 * had not been asked for yet and pass by finding nothing.
 */
const settled = async (result: { current: { index: { isSuccess: boolean } } }) =>
  waitFor(() => expect(result.current.index.isSuccess).toBe(true));

describe("finding siblings", () => {
  it("returns the other words sharing the root", async () => {
    const { result } = render({}, [aWord(0), aWord(1), aWord(2)]);

    await settled(result);
    expect(result.current.hook.siblings.map((w) => w.id)).toEqual(["voc-1", "voc-2"]);
  });

  it("matches roots that were saved in different spellings", async () => {
    const { result } = render({ root: "Act" }, [
      aWord(0, { root: "Act" }),
      aWord(1, { root: "act" }),
      aWord(2, { root: "act" }),
      aWord(3, { root: " ACT " }),
    ]);

    await settled(result);
    // The whole feature turns on this: these four cards are one family written
    // four ways, and comparing the stored strings made them four strangers.
    expect(result.current.hook.siblings.map((w) => w.id)).toEqual(["voc-1", "voc-2", "voc-3"]);
  });

  it("never returns the card being reviewed", async () => {
    const { result } = render({ excludeId: "voc-1" }, [aWord(0), aWord(1), aWord(2)]);

    await settled(result);
    // Showing the card as its own sibling is the sort of thing that reads as a
    // rendering bug rather than a data one.
    expect(result.current.hook.siblings.map((w) => w.id)).toEqual(["voc-0", "voc-2"]);
  });

  it("leaves out words on a different root", async () => {
    const { result } = render({}, [aWord(0), aWord(1), aWord(2, { root: "form" })]);

    await settled(result);
    expect(result.current.hook.siblings.map((w) => w.id)).toEqual(["voc-1"]);
  });

  it("scopes to the dialect of the card, not the app", async () => {
    const { result } = render({ dialect: "Egyptian" }, [
      aWord(0),
      aWord(1),
      aWord(2, { dialect: "Egyptian" }),
    ]);

    await settled(result);
    // A mixed-dialect session serves cards from all three decks at once. The
    // dialect that matters is the one on the card being reviewed — passing the
    // app's active dialect here matched an Egyptian card against Gulf siblings.
    expect(result.current.hook.siblings.map((w) => w.id)).toEqual(["voc-2"]);
  });

  it("leaves out another learner's words", async () => {
    const { result } = render({}, [aWord(0), aWord(1), aWord(2, { user_id: "someone-else" })]);

    await settled(result);
    expect(result.current.hook.siblings.map((w) => w.id)).toEqual(["voc-1"]);
  });

  it("returns an empty list when there are no siblings", async () => {
    const { result } = render({}, [aWord(0)]);

    await settled(result);
    // Empty rather than null: the caller renders a list, and a missing array is
    // a different branch from an empty one.
    expect(result.current.hook.siblings).toEqual([]);
    expect(result.current.hook.total).toBe(0);
  });

  it("orders the strongest-remembered words first", async () => {
    const { result } = render({}, [
      aWord(0),
      aWord(1, { ease_factor: 2 }),
      aWord(2, { ease_factor: 40 }),
      aWord(3, { ease_factor: 9 }),
    ]);

    await settled(result);
    // A word the learner barely remembers cannot anchor a new one to the
    // pattern. `ease_factor` holds FSRS stability, in days.
    expect(result.current.hook.siblings.map((w) => w.id)).toEqual(["voc-2", "voc-3", "voc-1"]);
  });

  it("caps the list but reports the true total", async () => {
    const { result } = render(
      {},
      Array.from({ length: 12 }, (_, index) => aWord(index)),
    );

    await settled(result);
    // The panel sits under a flashcard; twelve siblings would bury the card it
    // is meant to illuminate. The total is what lets "+N more" be honest rather
    // than pretending the family ends at the cap.
    expect(result.current.hook.siblings).toHaveLength(5);
    expect(result.current.hook.total).toBe(11);
  });

  it("carries what the panel renders", async () => {
    const { result } = render({}, [
      aWord(0),
      aWord(1, {
        word_arabic: "كتاب",
        word_english: "book",
        image_url: "https://cdn.test/book.png",
        word_audio_url: "https://cdn.test/book.mp3",
      }),
    ]);

    await settled(result);
    expect(result.current.hook.siblings[0]).toMatchObject({
      word_arabic: "كتاب",
      word_english: "book",
      root: ROOT,
      image_url: "https://cdn.test/book.png",
      word_audio_url: "https://cdn.test/book.mp3",
    });
  });

  it("hands back the family ready to render and to open a family with", async () => {
    const { result } = render({ root: "Act" }, [aWord(0, { root: "Act" })]);

    await settled(result);
    expect(result.current.hook.rootDisplay).toBe("act");
    expect(result.current.hook.familyKey).toBe("act");
  });
});

describe("when not to look", () => {
  it("finds nothing without a root", async () => {
    const { result } = render({ root: null }, [aWord(0), aWord(1)]);

    // Most saved words have no family yet — the backfill is opt-in — so this
    // is the common case, not an edge one.
    await settled(result);
    expect(result.current.hook.siblings).toEqual([]);
    expect(result.current.hook.familyKey).toBeNull();
    expect(result.current.hook.rootDisplay).toBeNull();
  });

  it("treats a whitespace-only root as no root", async () => {
    const { result } = render({ root: "   " }, [aWord(0), aWord(1)]);

    await settled(result);
    expect(result.current.hook.familyKey).toBeNull();
    expect(result.current.hook.siblings).toEqual([]);
  });

  it("treats the 'no root exists' sentinel as no root", async () => {
    const { result } = render({ root: "" }, [
      aWord(0, { root: "" }),
      aWord(1, { root: "" }),
    ]);

    await settled(result);
    // The backfill writes '' for loanwords and particles so it never pays for
    // them twice. If that were a key, every family-less word in the deck would be
    // a sibling of every other one.
    expect(result.current.hook.familyKey).toBeNull();
    expect(result.current.hook.siblings).toEqual([]);
  });

  it("finds nothing when disabled, even once the index is warm", async () => {
    const { result } = render({ enabled: false }, [aWord(0), aWord(1)]);

    // The index is shared and cached, so opting out has to suppress the
    // *result*, not merely the fetch — another surface may already have loaded
    // the very rows this caller asked not to see.
    await settled(result);
    expect(result.current.index.data?.size).toBe(1);
    expect(result.current.hook.siblings).toEqual([]);
    expect(result.current.hook.total).toBe(0);
  });

  it("finds nothing for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(
      () => useSiblingWords({ root: ROOT, excludeId: "voc-0", dialect: "Gulf" }),
      { persona: "anonymous" },
    );
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isLoading).toBe(false));
    expect(harness.result.current.siblings).toEqual([]);
  });
});
