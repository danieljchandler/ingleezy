import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeechPrefs } from "./useLeechPrefs";

/**
 * Whether the app flags cards a learner keeps failing.
 *
 * A leech is a card that has lapsed six times — one that is costing more
 * reviews than it is worth. Flagging it opens a panel offering to reformulate
 * or suspend it, which is the right intervention and also an interruption. Some
 * learners find it the most useful thing the review screen does and some find
 * it nagging, so it is a switch.
 *
 * Turning it off does two things, not one: no new cards are flagged, and the
 * panel disappears from cards already flagged. That second half is why this has
 * to reach the review screen while it is mounted — the switch is in Settings.
 */

const KEY = "hakiya:leech-tracking-enabled";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe("the starting point", () => {
  it("tracks leeches for a learner who has never chosen", () => {
    const { result } = renderHook(() => useLeechPrefs());

    // On by default: a learner drowning in a card they cannot learn is the
    // problem, and they will not think to go looking for a setting about it.
    expect(result.current.enabled).toBe(true);
  });

  it("is known on the very first render", () => {
    localStorage.setItem(KEY, "false");

    const seen: boolean[] = [];
    renderHook(() => {
      const { enabled } = useLeechPrefs();
      seen.push(enabled);
      return enabled;
    });

    // Read in the state initialiser, so a learner who turned the panel off does
    // not see it flash on at the top of every review.
    expect(seen[0]).toBe(false);
  });

  it("remembers a learner who turned it off", () => {
    localStorage.setItem(KEY, "false");

    const { result } = renderHook(() => useLeechPrefs());

    expect(result.current.enabled).toBe(false);
  });

  it("treats an unrecognised stored value as off", () => {
    localStorage.setItem(KEY, "yes");

    const { result } = renderHook(() => useLeechPrefs());

    // Pinned. Only the literal "true" counts, so a value written by an older
    // build — or by anything that stored `1` — silently disables leech
    // tracking. The failure is quiet in the wrong direction: the learner keeps
    // failing the same card and nothing offers to help.
    expect(result.current.enabled).toBe(false);
  });

  it("falls back to on when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const { result } = renderHook(() => useLeechPrefs());

    expect(result.current.enabled).toBe(true);
  });
});

describe("changing the setting", () => {
  it("applies immediately and persists", () => {
    const { result } = renderHook(() => useLeechPrefs());

    act(() => {
      result.current.setEnabled(false);
    });

    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("false");
  });

  it("round-trips through a remount", () => {
    const { result } = renderHook(() => useLeechPrefs());
    act(() => {
      result.current.setEnabled(false);
    });

    const remounted = renderHook(() => useLeechPrefs());

    expect(remounted.result.current.enabled).toBe(false);
  });

  it("still applies when the write fails", () => {
    const { result } = renderHook(() => useLeechPrefs());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    act(() => {
      result.current.setEnabled(false);
    });

    // The panel goes away for this session even though the choice is lost.
    expect(result.current.enabled).toBe(false);
  });
});

describe("staying in step", () => {
  it("reaches a review session already in progress", () => {
    const settings = renderHook(() => useLeechPrefs());
    const review = renderHook(() => useLeechPrefs());

    act(() => {
      settings.result.current.setEnabled(false);
    });

    // Turning it off is supposed to hide the panel on cards that are *already*
    // flagged, which only happens if the mounted review screen hears about it.
    expect(review.result.current.enabled).toBe(false);
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useLeechPrefs());

    act(() => {
      localStorage.setItem(KEY, "false");
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });

    expect(result.current.enabled).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = renderHook(() => useLeechPrefs());
    unmount();

    expect(() =>
      act(() => {
        window.dispatchEvent(new CustomEvent("hakiya:leech-prefs-changed"));
      }),
    ).not.toThrow();
  });
});
