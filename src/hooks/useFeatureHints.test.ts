import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFeatureHints } from "./useFeatureHints";

/**
 * Whether the small (i) hint icons appear across the app.
 *
 * They are there because the app has an unusual amount of machinery a learner
 * cannot infer — bridge mode, leech flagging, the new-card cap, the dialect
 * switch — and a tooltip at the point of confusion is worth more than a help
 * page nobody opens. They are also visual noise once you know what everything
 * does, which is why the switch exists.
 *
 * `src/lib/featureHints` owns the storage; this hook is the part that makes
 * flipping the switch in Settings take effect on the screen behind it.
 */

const KEY = "hakiya:feature-hints-enabled";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe("the starting point", () => {
  it("shows hints to someone who has never chosen", () => {
    const { result } = renderHook(() => useFeatureHints());

    // On by default, because the people who need them are exactly the people
    // who do not yet know the setting exists.
    expect(result.current.enabled).toBe(true);
  });

  it("is known on the very first render", () => {
    localStorage.setItem(KEY, "false");

    const seen: boolean[] = [];
    renderHook(() => {
      const { enabled } = useFeatureHints();
      seen.push(enabled);
      return enabled;
    });

    // Otherwise every page paints its hint icons once and then removes them,
    // which is more distracting than leaving them on.
    expect(seen[0]).toBe(false);
  });

  it("remembers a learner who turned them off", () => {
    localStorage.setItem(KEY, "false");

    const { result } = renderHook(() => useFeatureHints());

    expect(result.current.enabled).toBe(false);
  });

  it("treats an unrecognised stored value as off", () => {
    localStorage.setItem(KEY, "1");

    // Pinned. Only the literal "true" reads as on, so a value from an older
    // build hides the hints rather than showing them. Benign here — hints are
    // decoration — but it is the same comparison `useLeechPrefs` makes about
    // something that matters more.
    const { result } = renderHook(() => useFeatureHints());

    expect(result.current.enabled).toBe(false);
  });

  it("falls back to on when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const { result } = renderHook(() => useFeatureHints());

    expect(result.current.enabled).toBe(true);
  });
});

describe("changing the setting", () => {
  it("applies immediately and persists", () => {
    const { result } = renderHook(() => useFeatureHints());

    act(() => {
      result.current.setEnabled(false);
    });

    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("false");
  });

  it("round-trips through a remount", () => {
    const { result } = renderHook(() => useFeatureHints());
    act(() => {
      result.current.setEnabled(false);
    });

    const remounted = renderHook(() => useFeatureHints());

    expect(remounted.result.current.enabled).toBe(false);
  });

  it("still applies when the write fails", () => {
    const { result } = renderHook(() => useFeatureHints());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    act(() => {
      result.current.setEnabled(false);
    });

    expect(result.current.enabled).toBe(false);
  });
});

describe("staying in step", () => {
  it("clears the hints from the page behind the settings sheet", () => {
    const settings = renderHook(() => useFeatureHints());
    const page = renderHook(() => useFeatureHints());

    act(() => {
      settings.result.current.setEnabled(false);
    });

    // The switch and the icons it governs are never in the same tree, so a
    // broadcast is the only thing connecting them.
    expect(page.result.current.enabled).toBe(false);
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useFeatureHints());

    act(() => {
      localStorage.setItem(KEY, "false");
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });

    expect(result.current.enabled).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = renderHook(() => useFeatureHints());
    unmount();

    expect(() =>
      act(() => {
        window.dispatchEvent(new CustomEvent("hakiya:feature-hints-changed"));
      }),
    ).not.toThrow();
  });
});
