import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useGenerateStoryText, useStorySuggestions } from "./useStorySuggestions";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The admin's shortcut from "we need more reading material" to a draft.
 *
 * Finding authentic Arabic prose at a specific dialect and level is the slowest
 * part of building the reading library: a text has to be the right length, the
 * right dialect, and not already in the library. These two hooks split that in
 * half — first a list of candidate stories to pick from, then the full Arabic
 * text of the one chosen, so nobody has to go and find a source themselves.
 *
 * Both are mutations rather than queries because they are model calls that cost
 * money and only happen when an admin asks.
 */

const aSuggestion = (over: Record<string, unknown> = {}) => ({
  title: "The Merchant of Basra",
  title_arabic: "تاجر البصرة",
  description: "A short folk tale about a merchant",
  description_arabic: "حكاية قصيرة",
  source_type: "folk_tale",
  estimated_length: "short",
  themes: ["trade", "wit"],
  ...over,
});

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(seed: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(
    () => ({ suggest: useStorySuggestions(), expand: useGenerateStoryText() }),
    { persona: "admin", seed },
  );
  cleanup = harness.cleanup;
  return harness;
}

describe("suggesting stories", () => {
  it("returns the candidates the model proposed", async () => {
    const { result } = render((backend) =>
      backend.stubFunction("suggest-stories", { suggestions: [aSuggestion()] }),
    );

    const suggestions = await result.current.suggest.mutateAsync(undefined);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title_arabic).toBe("تاجر البصرة");
  });

  it("asks for a dialect and a level", async () => {
    const { result, backend } = render((backend) =>
      backend.stubFunction("suggest-stories", { suggestions: [] }),
    );

    await result.current.suggest.mutateAsync({ dialect: "Egyptian", difficulty: "beginner" });

    // Both matter: a C1 Gulf folk tale is useless to the A2 Egyptian shelf the
    // admin is trying to fill.
    expect(backend.lastCallTo("suggest-stories")?.body).toMatchObject({
      dialect: "Egyptian",
      difficulty: "beginner",
    });
  });

  it("falls back to Gulf at intermediate when asked for nothing", async () => {
    const { result, backend } = render((backend) =>
      backend.stubFunction("suggest-stories", { suggestions: [] }),
    );

    await result.current.suggest.mutateAsync(undefined);

    // Gulf is the app's primary module, and intermediate is the level with the
    // widest usable range of authentic material.
    expect(backend.lastCallTo("suggest-stories")?.body).toMatchObject({
      dialect: "Gulf",
      difficulty: "intermediate",
    });
  });

  it("reports a refused call", async () => {
    const { result } = render((backend) =>
      backend.stubFunctionFailure("suggest-stories", 500, { error: "gateway down" }),
    );

    await expect(result.current.suggest.mutateAsync(undefined)).rejects.toBeTruthy();
  });

  it("reports an error the function returned with a 200", async () => {
    const { result } = render((backend) =>
      backend.stubFunction("suggest-stories", { error: "no key configured" }),
    );

    // The functions answer 200 with an `error` field more often than they
    // answer a status code; treating that as success would render an empty
    // list as though the model had nothing to suggest.
    await expect(result.current.suggest.mutateAsync(undefined)).rejects.toThrow(
      "no key configured",
    );
  });

  it("refuses a reply whose suggestions are not a list", async () => {
    const { result } = render((backend) =>
      backend.stubFunction("suggest-stories", { suggestions: "The Merchant of Basra" }),
    );

    // A model that answered in prose rather than as structured output would
    // otherwise reach the admin UI as a string being mapped over.
    await expect(result.current.suggest.mutateAsync(undefined)).rejects.toThrow(
      "No suggestions returned",
    );
  });
});

describe("expanding a suggestion into a story", () => {
  it("returns the English text and its attribution", async () => {
    const { result } = render((backend) =>
      backend.stubFunction("generate-suggested-story-text", {
        body_english: "Once upon a time",
        author: "Anonymous",
      }),
    );

    const story = await result.current.expand.mutateAsync({
      suggestion: aSuggestion(),
      dialect: "Gulf",
      difficulty: "intermediate",
    });

    // English only. The dialect scaffold is import-authentic-story's job, so
    // that a generated story and a pasted one reach it by the same path.
    expect(story).toEqual({
      body_english: "Once upon a time",
      author: "Anonymous",
    });
  });

  it("passes the whole suggestion through, not just its title", async () => {
    const { result, backend } = render((backend) =>
      backend.stubFunction("generate-suggested-story-text", { body_english: "text" }),
    );

    await result.current.expand.mutateAsync({
      suggestion: aSuggestion(),
      dialect: "Yemeni",
      difficulty: "advanced",
    });

    // The themes and the estimated length are what keep the expansion faithful
    // to the card the admin picked; a title alone would produce a different
    // story from the one they chose.
    expect(backend.lastCallTo("generate-suggested-story-text")?.body).toMatchObject({
      title: "The Merchant of Basra",
      title_arabic: "تاجر البصرة",
      source_type: "folk_tale",
      estimated_length: "short",
      themes: ["trade", "wit"],
      dialect: "Yemeni",
      difficulty: "advanced",
    });
  });

  it("records an unattributed story as having no author", async () => {
    const { result } = render((backend) =>
      backend.stubFunction("generate-suggested-story-text", { body_english: "text" }),
    );

    const story = await result.current.expand.mutateAsync({
      suggestion: aSuggestion(),
      dialect: "Gulf",
      difficulty: "intermediate",
    });

    // Null rather than undefined: the value is written straight to a nullable
    // column, and an author line reading "undefined" would ship to learners.
    expect(story.author).toBeNull();
  });

  it("prefers the detailed reason when the function explains itself", async () => {
    const { result } = render((backend) =>
      backend.stubFunction("generate-suggested-story-text", {
        error: "generation_failed",
        detail: "the model returned MSA, not Gulf",
      }),
    );

    // The admin is the person who can act on this, and "generation_failed" is
    // not something anyone can act on.
    await expect(
      result.current.expand.mutateAsync({
        suggestion: aSuggestion(),
        dialect: "Gulf",
        difficulty: "intermediate",
      }),
    ).rejects.toThrow("the model returned MSA, not Gulf");
  });

  it("refuses a reply with no story text", async () => {
    const { result } = render((backend) =>
      backend.stubFunction("generate-suggested-story-text", { author: "Anonymous" }),
    );

    // Importing an empty story would create a reading-library row that renders
    // as a blank page.
    await expect(
      result.current.expand.mutateAsync({
        suggestion: aSuggestion(),
        dialect: "Gulf",
        difficulty: "intermediate",
      }),
    ).rejects.toThrow("No story text returned");
  });

  it("reports a refused call", async () => {
    const { result } = render((backend) =>
      backend.stubFunctionFailure("generate-suggested-story-text", 500),
    );

    await expect(
      result.current.expand.mutateAsync({
        suggestion: aSuggestion(),
        dialect: "Gulf",
        difficulty: "intermediate",
      }),
    ).rejects.toBeTruthy();
  });
});
