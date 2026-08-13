import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  messageIndexForElapsed,
  useLoadingMessage,
} from "@/hooks/useLoadingMessage";
import { LOADING_DECKS } from "@/data/loadingMessages";

describe("messageIndexForElapsed", () => {
  it("starts at the first message", () => {
    expect(messageIndexForElapsed(0, 5, 4000)).toBe(0);
    expect(messageIndexForElapsed(3999, 5, 4000)).toBe(0);
  });

  it("advances on each interval boundary", () => {
    expect(messageIndexForElapsed(4000, 5, 4000)).toBe(1);
    expect(messageIndexForElapsed(8000, 5, 4000)).toBe(2);
    expect(messageIndexForElapsed(12000, 5, 4000)).toBe(3);
  });

  // The whole point: a long wait must not loop round to "Setting up…".
  it("holds on the last message instead of wrapping", () => {
    expect(messageIndexForElapsed(16000, 5, 4000)).toBe(4);
    expect(messageIndexForElapsed(400000, 5, 4000)).toBe(4);
  });

  it("survives degenerate input", () => {
    expect(messageIndexForElapsed(5000, 1, 4000)).toBe(0);
    expect(messageIndexForElapsed(5000, 0, 4000)).toBe(0);
    expect(messageIndexForElapsed(-1, 5, 4000)).toBe(0);
    expect(messageIndexForElapsed(NaN, 5, 4000)).toBe(0);
    expect(messageIndexForElapsed(5000, 5, 0)).toBe(0);
  });
});

describe("useLoadingMessage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    // clearAllTimers, not runOnlyPendingTimers: flushing them here would fire
    // state updates outside act().
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("starts on the first message of the deck", () => {
    const { result } = renderHook(() =>
      useLoadingMessage({ task: "passage", intervalMs: 4000 }),
    );
    expect(result.current.message).toEqual(LOADING_DECKS.passage[0]);
    expect(result.current.index).toBe(0);
  });

  it("advances as the wait goes on", () => {
    const { result } = renderHook(() =>
      useLoadingMessage({ task: "passage", intervalMs: 4000 }),
    );
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.index).toBe(1);
    expect(result.current.message).toEqual(LOADING_DECKS.passage[1]);
  });

  it("reports elapsed seconds", () => {
    const { result } = renderHook(() => useLoadingMessage({ task: "passage" }));
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(result.current.elapsedSeconds).toBe(7);
  });

  it("settles on the last message for a very long wait", () => {
    const deck = LOADING_DECKS.passage;
    const { result } = renderHook(() =>
      useLoadingMessage({ task: "passage", intervalMs: 4000 }),
    );
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current.message).toEqual(deck[deck.length - 1]);
  });

  it("restarts the deck when a new wait begins", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useLoadingMessage({ task: "passage", active }),
      { initialProps: { active: true } },
    );
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(result.current.index).toBeGreaterThan(0);

    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.index).toBe(0);
    expect(result.current.elapsedSeconds).toBe(0);
  });

  it("runs no timer while inactive", () => {
    renderHook(() => useLoadingMessage({ task: "passage", active: false }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer on unmount", () => {
    const { unmount } = renderHook(() => useLoadingMessage({ task: "passage" }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets a real progress label win over the deck", () => {
    const { result } = renderHook(() =>
      useLoadingMessage({ task: "passage", override: "Transcribing audio…" }),
    );
    expect(result.current.message.en).toBe("Transcribing audio…");
    expect(result.current.message.ar).toBe("نفرغ الكلام");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.message.en).toBe("Transcribing audio…");
  });
});
