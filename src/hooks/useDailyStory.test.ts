import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aProfile, daysAgo, TEST_USER_ID } from "@/test/support/factories";
import { useDailyStory, useGenerateDailyStory } from "./useDailyStory";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Today's story, written from the learner's own saved words.
 *
 * It is the app's answer to the oldest problem in vocabulary study: a word
 * learned on a flashcard is not a word you can use. A short story that happens
 * to contain the eleven words you saved this fortnight puts them in a sentence
 * you have a reason to read, and the same words come back tomorrow in a
 * different one.
 *
 * One per learner, per dialect, per day. Generating it costs a model call, so
 * the read and the generate are deliberately separate hooks: the page shows
 * what already exists and only pays when the learner asks for it.
 */

const STORY_TABLE = "daily_vocab_stories";

const todayUtc = () => new Date().toISOString().slice(0, 10);

const aDailyStory = (over: Record<string, unknown> = {}) => ({
  id: "story-1",
  user_id: TEST_USER_ID,
  story_date: todayUtc(),
  dialect: "Gulf",
  title: "في السوق",
  body_arabic: "رحت السوق اليوم",
  body_english: "I went to the souq today",
  body_literal_arabic: null,
  vocab_used: ["سوق"],
  new_words: [],
  audio_url: null,
  created_at: daysAgo(0),
  updated_at: daysAgo(0),
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function render(
  rows: Record<string, unknown>[],
  { dialect = "Gulf", fn }: { dialect?: string; fn?: (backend: SupabaseBackend) => void } = {},
) {
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const seed = (backend: SupabaseBackend) => {
    backend.db.seed("profiles", [aProfile({ user_id: TEST_USER_ID, preferred_dialect: dialect })]);
    backend.db.seed(STORY_TABLE, rows);
    fn?.(backend);
  };
  const harness = renderHookWithProviders(
    () => ({ story: useDailyStory(), generate: useGenerateDailyStory() }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  return harness;
}

describe("reading today's story", () => {
  it("returns the one written for today", async () => {
    const { result } = render([aDailyStory()]);

    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));
    expect(result.current.story.data?.title).toBe("في السوق");
  });

  it("ignores yesterday's story", async () => {
    const { result } = render([aDailyStory({ story_date: "2020-01-01" })]);

    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));
    // Null rather than stale: showing yesterday's story as today's would make
    // the daily habit indistinguishable from not having done it.
    expect(result.current.story.data).toBeNull();
  });

  it("ignores another dialect's story", async () => {
    const { result } = render([aDailyStory({ dialect: "Egyptian" })]);

    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));
    // A learner studying two dialects gets a story in each, built from that
    // dialect's saved words.
    expect(result.current.story.data).toBeNull();
  });

  it("ignores another learner's story", async () => {
    const { result } = render([aDailyStory({ user_id: "someone-else" })]);

    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));
    expect(result.current.story.data).toBeNull();
  });

  it("returns null rather than erroring when nothing has been written", async () => {
    const { result } = render([]);

    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));
    // "Not yet today" is the state the page is built around — it is what puts
    // the generate button on screen.
    expect(result.current.story.data).toBeNull();
  });

  it("never generates on its own", async () => {
    const { result, backend } = render([]);

    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));
    // Reading is free and generating is a model call. Merging the two would
    // spend one every time the page was opened.
    expect(backend.callsTo("generate-daily-story")).toEqual([]);
  });

  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useDailyStory(), { persona: "anonymous" });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });

  it("surfaces a failed read rather than reporting no story", async () => {
    const harness = renderHookWithProviders(() => useDailyStory(), {
      persona: "free",
      seed: (backend) => backend.db.failAlways(STORY_TABLE, 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    // "No story yet" invites the learner to spend a generation on one they may
    // already have.
    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });
});

describe("generating one", () => {
  it("asks for the dialect the learner is studying", async () => {
    const { result, backend } = render([], {
      dialect: "Egyptian",
      fn: (b) => b.stubFunction("generate-daily-story", { story: aDailyStory() }),
    });
    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));

    await result.current.generate.mutateAsync(undefined);

    expect(backend.lastCallTo("generate-daily-story")?.body).toMatchObject({
      dialect: "Egyptian",
      force: false,
    });
  });

  it("takes the cached story rather than paying twice by default", async () => {
    const { result, backend } = render([], {
      fn: (b) => b.stubFunction("generate-daily-story", { story: aDailyStory() }),
    });
    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));

    await result.current.generate.mutateAsync(undefined);

    // The function returns an existing story unless forced; the flag is what
    // separates "show me today's" from "write me another".
    expect(backend.lastCallTo("generate-daily-story")?.body).toMatchObject({ force: false });
  });

  it("can be told to write a fresh one", async () => {
    const { result, backend } = render([], {
      fn: (b) => b.stubFunction("generate-daily-story", { story: aDailyStory() }),
    });
    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));

    await result.current.generate.mutateAsync({ force: true });

    expect(backend.lastCallTo("generate-daily-story")?.body).toMatchObject({ force: true });
  });

  it("puts the new story on screen without a reload", async () => {
    const { result, backend } = render([], {
      fn: (b) => b.stubFunction("generate-daily-story", { story: aDailyStory() }),
    });
    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));
    backend.db.seed(STORY_TABLE, [aDailyStory()]);

    await result.current.generate.mutateAsync(undefined);

    // The read is invalidated on success, so the page moves from the empty
    // state to the story the learner just paid for.
    await waitFor(() => expect(result.current.story.data?.title).toBe("في السوق"));
  });

  it("reports a refused generation", async () => {
    const { result } = render([], {
      fn: (b) => b.stubFunctionFailure("generate-daily-story", 429, { error: "daily_limit" }),
    });
    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));

    await expect(result.current.generate.mutateAsync(undefined)).rejects.toBeTruthy();
  });

  it("treats a reply with no story as a failure", async () => {
    const { result } = render([], {
      fn: (b) => b.stubFunction("generate-daily-story", { message: "not enough saved words" }),
    });
    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));

    // A 200 carrying an explanation instead of a story is the shape this
    // function uses for "you have nothing to write about yet" — silently
    // resolving would leave the page spinning on an empty result.
    await expect(result.current.generate.mutateAsync(undefined)).rejects.toThrow(
      "not enough saved words",
    );
  });

  it("says something useful when the reply is empty", async () => {
    const { result } = render([], {
      fn: (b) => b.stubFunction("generate-daily-story", {}),
    });
    await waitFor(() => expect(result.current.story.isSuccess).toBe(true));

    await expect(result.current.generate.mutateAsync(undefined)).rejects.toThrow(
      "No story returned",
    );
  });
});
