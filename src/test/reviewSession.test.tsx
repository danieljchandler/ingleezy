import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// The session hook composes three react-query count hooks. Mock those so the
// test covers the ordering/handoff logic rather than Supabase plumbing.
const mocks = vi.hoisted(() => ({
  curriculumDue: 0,
  myWordsDue: 0,
  phrasesDue: 0,
}));

vi.mock("@/hooks/useReview", () => ({
  useReviewStats: () => ({ data: { dueCount: mocks.curriculumDue }, isLoading: false }),
}));
vi.mock("@/hooks/useUserVocabulary", () => ({
  useUserVocabularyDueCount: () => ({ data: { dueCount: mocks.myWordsDue }, isLoading: false }),
}));
vi.mock("@/hooks/useUserPhrases", () => ({
  useUserPhrasesDueCount: () => ({ data: { dueCount: mocks.phrasesDue }, isLoading: false }),
}));

import { useReviewSession } from "@/hooks/useReviewSession";

const setDue = (curriculum: number, myWords: number, phrases: number) => {
  mocks.curriculumDue = curriculum;
  mocks.myWordsDue = myWords;
  mocks.phrasesDue = phrases;
};

describe("useReviewSession", () => {
  beforeEach(() => setDue(0, 0, 0));

  it("sums cards due across all three decks", () => {
    setDue(3, 4, 5);
    const { result } = renderHook(() => useReviewSession());
    expect(result.current.totalDue).toBe(12);
  });

  it("hands off to the next deck that still has cards", () => {
    setDue(0, 6, 2);
    const { result } = renderHook(() => useReviewSession());
    expect(result.current.nextDeck("curriculum")?.id).toBe("my-words");
    expect(result.current.nextDeck("my-words")?.id).toBe("my-phrases");
  });

  it("skips empty decks when choosing the next one", () => {
    setDue(0, 0, 7);
    const { result } = renderHook(() => useReviewSession());
    expect(result.current.nextDeck("curriculum")?.id).toBe("my-phrases");
  });

  it("never hands off to the deck just finished", () => {
    setDue(0, 5, 0);
    const { result } = renderHook(() => useReviewSession());
    expect(result.current.nextDeck("my-words")).toBeNull();
  });

  it("can hand off backwards so entering mid-session isn't a dead end", () => {
    // Landing straight on /review/my-words (old bookmark, Today task) and
    // clearing it should still offer the curriculum cards waiting behind it.
    setDue(4, 0, 0);
    const { result } = renderHook(() => useReviewSession());
    expect(result.current.nextDeck("my-words")?.id).toBe("curriculum");
  });

  it("returns null once every deck is clear", () => {
    setDue(0, 0, 0);
    const { result } = renderHook(() => useReviewSession());
    expect(result.current.nextDeck("curriculum")).toBeNull();
    expect(result.current.totalDue).toBe(0);
  });

  it("counts cards due outside the current deck", () => {
    setDue(3, 4, 5);
    const { result } = renderHook(() => useReviewSession());
    expect(result.current.dueElsewhere("curriculum")).toBe(9);
    expect(result.current.dueElsewhere("my-phrases")).toBe(7);
  });
});
