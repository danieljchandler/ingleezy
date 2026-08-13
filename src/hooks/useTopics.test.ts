import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aProfile, aTopic, topicId, TEST_USER_ID } from "@/test/support/factories";
import { useTopics } from "./useTopics";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The vocabulary topics for the dialect a learner is studying.
 *
 * Topics are the browsable half of the vocabulary — Food, Family, At the Souq —
 * and they are per dialect, because the words are. A Gulf learner shown the
 * Egyptian topic list would tap "Food" and get Egyptian vocabulary in a Gulf
 * course, which is the specific confusion the whole dialect-module split exists
 * to prevent.
 *
 * So the dialect belongs in the query *and* in the cache key: switching dialect
 * has to refetch, not re-render the same list under a new heading.
 */

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function render(rows: Record<string, unknown>[], dialect = "Gulf") {
  // DialectContext seeds from localStorage and then re-syncs from the profile
  // row, so both have to name the same dialect or the provider snaps back.
  localStorage.setItem("hakiya_dialect_module", dialect);
  const seed = (backend: SupabaseBackend) => {
    backend.db.seed("profiles", [aProfile({ user_id: TEST_USER_ID, preferred_dialect: dialect })]);
    backend.db.seed("topics", rows);
  };
  const harness = renderHookWithProviders(() => useTopics(), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("listing the topics", () => {
  it("returns them in display order", async () => {
    const { result } = render([
      aTopic({ id: topicId(1), name: "Second", display_order: 2 }),
      aTopic({ id: topicId(0), name: "First", display_order: 1 }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Curated order, not alphabetical: the first topics are the ones a beginner
    // can use on day one.
    expect(result.current.data?.map((topic) => topic.name)).toEqual(["First", "Second"]);
  });

  it("leaves out the other dialects' topics", async () => {
    const { result } = render([
      aTopic({ id: topicId(0), name: "Gulf Food", dialect_module: "Gulf" }),
      aTopic({ id: topicId(1), name: "Egyptian Food", dialect_module: "Egyptian" }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((topic) => topic.name)).toEqual(["Gulf Food"]);
  });

  it("returns the other dialect's topics for a learner studying it", async () => {
    const { result } = render(
      [
        aTopic({ id: topicId(0), name: "Gulf Food", dialect_module: "Gulf" }),
        aTopic({ id: topicId(1), name: "Egyptian Food", dialect_module: "Egyptian" }),
      ],
      "Egyptian",
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((topic) => topic.name)).toEqual(["Egyptian Food"]);
  });

  it("carries what the topic card renders", async () => {
    const { result } = render([
      aTopic({ name: "At the Souq", name_arabic: "في السوق", icon: "🛍️", gradient: "bg-warm" }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({
      name: "At the Souq",
      name_arabic: "في السوق",
      icon: "🛍️",
      gradient: "bg-warm",
    });
  });

  it("returns an empty list when a dialect has no topics yet", async () => {
    const { result } = render([aTopic({ dialect_module: "Yemeni" })]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Yemeni is the newest module and genuinely thin in places; an empty list
    // is a real state, not a failure.
    expect(result.current.data).toEqual([]);
  });

  it("caches per dialect", async () => {
    const { result, backend } = render([aTopic()]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The dialect is in the query key, so switching modules cannot serve the
    // previous dialect's list from cache while the new one loads.
    expect(backend.db.reads.filter((read) => read.table === "topics").length).toBe(1);
  });
});

describe("when the read fails", () => {
  it("surfaces the error rather than an empty topic list", async () => {
    localStorage.setItem("hakiya_dialect_module", "Gulf");
    const harness = renderHookWithProviders(() => useTopics(), {
      persona: "free",
      seed: (backend) => backend.db.failAlways("topics", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });
});
