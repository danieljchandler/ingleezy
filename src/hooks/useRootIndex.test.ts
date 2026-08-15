import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aUserVocabulary, TEST_USER_ID } from "@/test/support/factories";
import { saveRootFamiliesEnabled } from "@/lib/rootFamilyPrefs";
import { useRootIndex } from "./useRootIndex";
import { useSiblingWords } from "./useSiblingWords";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The learner's family-bearing vocabulary, bucketed by canonical family.
 *
 * The shape of this hook is the whole argument for it. The lookup it replaced
 * ran *inside* the review loop — one round trip per card revealed — and asked
 * SQL to compare an unnormalised free-text column, so it was simultaneously the
 * most frequent query in a review session and one that could not match. Fetching
 * once and grouping in TypeScript makes it both cheaper and correct: `familyKey`
 * reconciles the spellings already sitting in the database, with no migration
 * and no backfill of existing rows.
 *
 * Two properties are worth pinning because breaking either is invisible:
 * the query runs once no matter how many cards ask, and it does not run at all
 * when the learner has the feature switched off.
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

/** Count the REST calls the hook makes. `seed` runs after the transport is installed. */
function countingSeed(rows: Record<string, unknown>[], counter: { vocabularyReads: number }) {
  return (backend: SupabaseBackend) => {
    backend.db.seed("user_vocabulary", rows);
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/rest/v1/user_vocabulary")) counter.vocabularyReads++;
      return realFetch(input, init);
    }) as typeof fetch;
  };
}

function render(rows: Record<string, unknown>[] = []) {
  const harness = renderHookWithProviders(() => useRootIndex(), { persona: "free", seed:
    (backend: SupabaseBackend) => backend.db.seed("user_vocabulary", rows) });
  cleanup = harness.cleanup;
  return harness;
}

describe("bucketing the deck", () => {
  it("groups differently-spelled families under one key", async () => {
    const { result } = render([
      aWord(0, { root: "Act" }),
      aWord(1, { root: "act" }),
      aWord(2, { root: " ACT " }),
      aWord(3, { root: "form" }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect([...(result.current.data?.keys() ?? [])].sort()).toEqual(["act", "form"]);
    expect(result.current.data?.get("act")?.map((w) => w.id).sort()).toEqual([
      "voc-0",
      "voc-1",
      "voc-2",
    ]);
  });

  it("spans dialects, because a root does", async () => {
    const { result } = render([aWord(0), aWord(1, { dialect: "Yemeni" })]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Scoping the query by dialect would be wrong for a mixed-dialect session,
    // where the deck spans all three at once. The per-card filter is the
    // caller's job — this index has to be able to answer for any of them.
    expect(result.current.data?.get("act")).toHaveLength(2);
  });

  it("orders each family strongest-remembered first", async () => {
    const { result } = render([
      aWord(0, { ease_factor: 3 }),
      aWord(1, { ease_factor: 45 }),
      aWord(2, { ease_factor: 12 }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // `ease_factor` holds FSRS stability in days — how well the word is
    // remembered right now, which is what makes it usable as an anchor.
    expect(result.current.data?.get("act")?.map((w) => w.id)).toEqual([
      "voc-1",
      "voc-2",
      "voc-0",
    ]);
  });

  it("leaves out another learner's words", async () => {
    const { result } = render([aWord(0), aWord(1, { user_id: "someone-else" })]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get("act")).toHaveLength(1);
  });
});

describe("what never enters the index", () => {
  it("skips words nobody has looked up a root for", async () => {
    const { result } = render([aWord(0), aWord(1, { root: null })]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get("act")).toHaveLength(1);
  });

  it("skips the 'no root exists' sentinel rather than making a family of it", async () => {
    const { result } = render([
      aWord(0, { root: "" }),
      aWord(1, { root: "" }),
      aWord(2, { root: "" }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // '' is written deliberately by the backfill for loanwords and particles so
    // it never pays to look them up twice. Keyed on, it would collect every
    // family-less word in the deck into one enormous false family.
    expect(result.current.data?.size).toBe(0);
  });

  it("skips families that cannot be read as base forms", async () => {
    const { result } = render([
      aWord(0, { root: "n/a" }),
      // An Arabic root from before the flip. It has to drop out of the index
      // rather than form a family an English learner cannot use.
      aWord(1, { root: "ك ت ب" }),
      aWord(2, { root: "the act of doing" }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.size).toBe(0);
  });
});

describe("what it costs", () => {
  it("reads the deck once however many cards ask", async () => {
    const counter = { vocabularyReads: 0 };
    const harness = renderHookWithProviders(
      () => ({
        // Five cards on five different families, as a review session would.
        a: useSiblingWords({ root: "act", excludeId: "x", dialect: "Gulf" }),
        b: useSiblingWords({ root: "form", excludeId: "x", dialect: "Gulf" }),
        c: useSiblingWords({ root: "Act", excludeId: "x", dialect: "Gulf" }),
        d: useSiblingWords({ root: "use", excludeId: "x", dialect: "Gulf" }),
        index: useRootIndex(),
      }),
      {
        persona: "free",
        seed: countingSeed([aWord(0), aWord(1, { root: "form" })], counter),
      },
    );
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.index.isSuccess).toBe(true));
    // The point of the rewrite: the query this replaced fired once per card
    // revealed, so a forty-card session made forty round trips.
    expect(counter.vocabularyReads).toBe(1);
  });

  it("does not read anything when the learner has the feature off", async () => {
    const counter = { vocabularyReads: 0 };
    saveRootFamiliesEnabled(false);

    const harness = renderHookWithProviders(() => useRootIndex(), {
      persona: "free",
      seed: countingSeed([aWord(0), aWord(1)], counter),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
    // Off means no request, not a hidden panel — otherwise every learner who
    // turned it off would still pay for it on every review session.
    expect(counter.vocabularyReads).toBe(0);
    expect(harness.result.current.data).toBeUndefined();
  });

  it("does not read anything for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useRootIndex(), { persona: "anonymous" });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });

  it("can be switched off by its caller", async () => {
    const harness = renderHookWithProviders(() => useRootIndex({ enabled: false }), {
      persona: "free",
      seed: (backend: SupabaseBackend) => backend.db.seed("user_vocabulary", [aWord(0)]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });
});
