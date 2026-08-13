import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useComprehensionMap } from "./useComprehensionMap";
import { MIN_KNOWN_WORDS } from "@/lib/comprehension";

/**
 * The glue between the decks in cache and the browse grid. The load-bearing
 * rule: a learner with a near-empty deck gets an EMPTY map — no bars, no
 * filter chip — because coverage computed from nothing reads as "everything
 * is impossibly hard" on day one.
 */

const decks = vi.hoisted(() => ({
  words: [] as Array<{ word_arabic: string }>,
  phrases: [] as Array<{ phrase_arabic: string }>,
}));

vi.mock("@/hooks/useUserVocabulary", () => ({
  useUserVocabulary: () => ({ data: decks.words }),
}));
vi.mock("@/hooks/useUserPhrases", () => ({
  useUserPhrases: () => ({ data: decks.phrases }),
}));

/** Ten distinct known words, and a transcript long enough to score. */
const KNOWN_WORDS = ["كبسه", "مطعم", "قهوه", "شاهي", "سياره", "مدرسه", "شغل", "بحر", "سوق", "عشا"];

const video = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  dialect: "Gulf",
  transcript_lines: Array.from({ length: 12 }, () => ({ arabic: "كبسه مطعم قهوه" })),
  ...over,
});

function fill(words: string[]) {
  decks.words = words.map((w) => ({ word_arabic: w }));
  decks.phrases = [];
}

describe("useComprehensionMap", () => {
  it("stays empty until the learner has saved enough words", () => {
    fill(KNOWN_WORDS.slice(0, MIN_KNOWN_WORDS - 1));
    const { result } = renderHook(() => useComprehensionMap([video("v1")]));
    expect(result.current.size).toBe(0);
  });

  it("scores each measurable video once the deck is real", () => {
    fill(KNOWN_WORDS);
    const { result } = renderHook(() => useComprehensionMap([video("v1")]));
    const c = result.current.get("v1");
    expect(c).toBeDefined();
    expect(c!.coverage).toBe(1);
    expect(c!.band).toBe("comfortable");
  });

  it("leaves out a video whose transcript can't be measured", () => {
    fill(KNOWN_WORDS);
    const { result } = renderHook(() =>
      useComprehensionMap([video("v1"), video("v2", { transcript_lines: null })]),
    );
    expect(result.current.has("v1")).toBe(true);
    expect(result.current.has("v2")).toBe(false);
  });

  it("handles no videos at all", () => {
    fill(KNOWN_WORDS);
    const { result } = renderHook(() => useComprehensionMap(undefined));
    expect(result.current.size).toBe(0);
  });
});
