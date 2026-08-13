import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRootFamilyPrefs } from "./useRootFamilyPrefs";

/**
 * Whether the app shows a learner the other words they know that are built
 * from the same Arabic root.
 *
 * Arabic morphology is the reason it exists: كتب, كتاب, مكتب and كاتب are one
 * root apart, and seeing them together turns four separate memorisations into
 * one pattern. It is also, for some people, exactly the wrong thing to be
 * looking at while trying to recall a single card — so it is a switch.
 *
 * The switch lives in Settings and the thing it controls lives on the review
 * screen, so a change has to reach a session that is already mounted, in this
 * tab or another one. And because the preference also gates the root-index
 * query, "off" has to be known on the very first render: a hook that started
 * at the default and corrected itself in an effect would fire the query once
 * for every learner who had turned the feature off.
 */

const KEY = "ingleezy:root-families-enabled";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe("the starting point", () => {
  it("is on for a learner who has never chosen", () => {
    const { result } = renderHook(() => useRootFamilyPrefs());

    expect(result.current.enabled).toBe(true);
  });

  it("is known on the very first render, not after an effect", () => {
    localStorage.setItem(KEY, "false");

    const { result } = renderHook(() => useRootFamilyPrefs());

    // If this were false only after the first effect, the root-index query
    // would already have been fired for a learner who wants it off.
    expect(result.current.enabled).toBe(false);
  });
});

describe("changing it", () => {
  it("persists the choice", () => {
    const { result } = renderHook(() => useRootFamilyPrefs());

    act(() => result.current.setEnabled(false));

    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("false");
  });

  it("survives a remount", () => {
    const { result, unmount } = renderHook(() => useRootFamilyPrefs());
    act(() => result.current.setEnabled(false));
    unmount();

    const second = renderHook(() => useRootFamilyPrefs());

    expect(second.result.current.enabled).toBe(false);
  });

  it("reaches a second component already mounted", () => {
    // Settings and the review screen hold separate instances of this hook.
    const settings = renderHook(() => useRootFamilyPrefs());
    const review = renderHook(() => useRootFamilyPrefs());

    act(() => settings.result.current.setEnabled(false));

    expect(review.result.current.enabled).toBe(false);
  });

  it("reaches a session running in another tab", () => {
    const { result } = renderHook(() => useRootFamilyPrefs());

    act(() => {
      localStorage.setItem(KEY, "false");
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "false" }));
    });

    expect(result.current.enabled).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { result, unmount } = renderHook(() => useRootFamilyPrefs());
    unmount();

    expect(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "false" }));
    }).not.toThrow();
    expect(result.current.enabled).toBe(true);
  });
});
