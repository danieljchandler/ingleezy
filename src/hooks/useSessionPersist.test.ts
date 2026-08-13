import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionPersist, useSessionState } from "./useSessionPersist";

/**
 * State that survives a reload for four hours.
 *
 * This is what stops a locked phone, a background tab reload or a stray back
 * gesture costing a learner a half-finished quiz or a page of transcript
 * corrections. The TTL is the other half: yesterday's abandoned session is not
 * something anyone means to resume, and restoring it silently is worse than
 * starting fresh, because the learner cannot tell which they are looking at.
 *
 * Every read is wrapped, because the stored value is JSON written by an older
 * version of the app as often as by this one.
 */

const KEY = "test-flow";
const STORAGE_KEY = `session_${KEY}`;
const FOUR_HOURS = 4 * 60 * 60 * 1000;

/** Write an entry as the hook would have. */
function persisted(data: unknown, savedAt = Date.now()) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, savedAt }));
}

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSessionPersist", () => {
  it("starts from the initial value when nothing is stored", () => {
    const { result } = renderHook(() => useSessionPersist(KEY, "start"));

    expect(result.current[0]).toBe("start");
  });

  it("writes nothing until the value actually changes", () => {
    renderHook(() => useSessionPersist(KEY, "start"));

    // Persisting on mount would rewrite `savedAt` on every page load and keep
    // an abandoned session alive forever.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("persists a change", () => {
    const { result } = renderHook(() => useSessionPersist(KEY, "start"));

    act(() => {
      result.current[1]("changed");
    });

    expect(stored().data).toBe("changed");
  });

  it("restores what was stored", () => {
    persisted("restored");

    const { result } = renderHook(() => useSessionPersist(KEY, "start"));

    expect(result.current[0]).toBe("restored");
  });

  it("restores structured state, not just strings", () => {
    persisted({ index: 3, answers: [true, false] });

    const { result } = renderHook(() =>
      useSessionPersist(KEY, { index: 0, answers: [] as boolean[] }),
    );

    expect(result.current[0]).toEqual({ index: 3, answers: [true, false] });
  });

  it("accepts an updater function like useState does", () => {
    const { result } = renderHook(() => useSessionPersist(KEY, 1));

    act(() => {
      result.current[1]((n) => n + 1);
    });

    expect(result.current[0]).toBe(2);
    expect(stored().data).toBe(2);
  });

  it("discards an entry past its time to live", () => {
    persisted("stale", Date.now() - FOUR_HOURS - 1000);

    const { result } = renderHook(() => useSessionPersist(KEY, "start"));

    expect(result.current[0]).toBe("start");
    // Removed rather than left to be re-read on the next mount.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps an entry just inside its time to live", () => {
    persisted("fresh", Date.now() - FOUR_HOURS + 60_000);

    const { result } = renderHook(() => useSessionPersist(KEY, "start"));

    expect(result.current[0]).toBe("fresh");
  });

  it("honours a custom time to live", () => {
    persisted("stale", Date.now() - 90_000);

    const { result } = renderHook(() => useSessionPersist(KEY, "start", 60_000));

    expect(result.current[0]).toBe("start");
  });

  it("falls back to the initial value on unreadable JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

    const { result } = renderHook(() => useSessionPersist(KEY, "start"));

    // A truncated write must not brick the page it was meant to protect.
    expect(result.current[0]).toBe("start");
  });

  it("survives storage being unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const { result } = renderHook(() => useSessionPersist(KEY, "start"));

    expect(result.current[0]).toBe("start");
  });

  it("does not throw when the quota is exhausted", () => {
    const { result } = renderHook(() => useSessionPersist(KEY, "start"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // Losing the safety net is survivable; losing the session in front of the
    // learner is not.
    expect(() =>
      act(() => {
        result.current[1]("changed");
      }),
    ).not.toThrow();
    expect(result.current[0]).toBe("changed");
  });

  it("clears the stored entry on request", () => {
    const { result } = renderHook(() => useSessionPersist(KEY, "start"));
    act(() => {
      result.current[1]("changed");
    });

    act(() => {
      result.current[2]();
    });

    // What a finished session calls, so the next visit starts clean.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("namespaces the key so two flows cannot collide", () => {
    const { result } = renderHook(() => useSessionPersist("flow-a", "a"));
    act(() => {
      result.current[1]("changed");
    });

    expect(localStorage.getItem("session_flow-a")).not.toBeNull();
    expect(localStorage.getItem("flow-a")).toBeNull();
  });
});

describe("useSessionState", () => {
  it("starts from the initial state and says it was not restored", () => {
    const { result } = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));

    expect(result.current.state).toEqual({ index: 0, score: 0 });
    // The flag drives a "resuming where you left off" notice; a false positive
    // would show it on a fresh session.
    expect(result.current.restored).toBe(false);
  });

  it("merges a stored state over the initial one", () => {
    persisted({ index: 3 });

    const { result } = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));

    // Merging rather than replacing is what lets a new field be added to a
    // flow without stranding everyone mid-session on an older shape.
    expect(result.current.state).toEqual({ index: 3, score: 0 });
    expect(result.current.restored).toBe(true);
  });

  it("updates only the fields it is given", () => {
    const { result } = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));

    act(() => {
      result.current.update({ score: 5 });
    });

    expect(result.current.state).toEqual({ index: 0, score: 5 });
  });

  it("persists the whole state, not just the change", () => {
    const { result } = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));

    act(() => {
      result.current.update({ score: 5 });
    });

    expect(stored().data).toEqual({ index: 0, score: 5 });
  });

  it("discards a state past its time to live", () => {
    persisted({ index: 3 }, Date.now() - FOUR_HOURS - 1000);

    const { result } = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));

    expect(result.current.state).toEqual({ index: 0, score: 0 });
    expect(result.current.restored).toBe(false);
  });

  it("resets what is on screen on clear", () => {
    persisted({ index: 3, score: 9 });
    const { result } = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));

    act(() => {
      result.current.clear();
    });

    // The single-value hook only clears storage; this one also resets the
    // state, because it is what a "start over" button calls.
    expect(result.current.state).toEqual({ index: 0, score: 0 });
  });

  it("re-persists the initial state instead of leaving storage empty", () => {
    persisted({ index: 3, score: 9 });
    const { result } = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));

    act(() => {
      result.current.clear();
    });

    // Pinned, not fixed. `clear` removes the entry and then calls
    // `setState(initialState)`, which trips the persist effect and writes a
    // fresh entry straight back — so the key is never actually empty. The
    // stored value is harmless (it is the initial state), but the side effect
    // is not: the next mount inside the TTL restores it and reports
    // `restored: true`, so a session the learner explicitly abandoned comes
    // back wearing a "resuming where you left off" notice.
    expect(stored().data).toEqual({ index: 0, score: 0 });

    const remounted = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));
    expect(remounted.result.current.restored).toBe(true);
  });

  it("falls back to the initial state on unreadable JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

    const { result } = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));

    expect(result.current.state).toEqual({ index: 0, score: 0 });
    expect(result.current.restored).toBe(false);
  });

  it("keeps reporting a restore after the state moves on", () => {
    persisted({ index: 3 });
    const { result } = renderHook(() => useSessionState(KEY, { index: 0, score: 0 }));

    act(() => {
      result.current.update({ score: 1 });
    });

    // Pinned as intended: `restored` describes how this mount began, not what
    // the state is now, so a resumed session keeps its notice as the learner
    // works. It is held in a ref precisely so updating it cannot cause a
    // second render during the first one.
    expect(result.current.restored).toBe(true);
  });
});
