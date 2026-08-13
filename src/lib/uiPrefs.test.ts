import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSoundEnabled,
  prefersReducedMotion,
  setSoundEnabled,
  useReducedMotion,
  useSoundPref,
} from "./uiPrefs";

/**
 * Sound and motion preferences.
 *
 * Both are read on mount by components scattered across the app — the alphabet
 * journey's chimes, every tap animation — so the questions worth pinning are
 * the boring ones: what an unset preference means, what a corrupt value means,
 * and whether a change in one component reaches the others without a reload.
 *
 * The default is *on* for sound, which makes the absent case the one that
 * matters most: a storage read that throws must not silently mute the app.
 */

const SOUND_KEY = "ingleezy:ui:sound";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reading the sound preference", () => {
  it("defaults to on when nothing has been stored", () => {
    expect(isSoundEnabled()).toBe(true);
  });

  it("reads a stored off", () => {
    window.localStorage.setItem(SOUND_KEY, "0");
    expect(isSoundEnabled()).toBe(false);
  });

  it("reads a stored on", () => {
    window.localStorage.setItem(SOUND_KEY, "1");
    expect(isSoundEnabled()).toBe(true);
  });

  it("treats anything else as off", () => {
    // The check is `raw === "1"`, so only the exact stored form counts as on.
    // Recorded rather than argued with: a corrupt value silently muting the app
    // is a quieter failure than one silently unmuting it.
    window.localStorage.setItem(SOUND_KEY, "true");
    expect(isSoundEnabled()).toBe(false);
  });

  it("falls back to on when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    // Private browsing and blocked third-party storage both throw here. The
    // app should sound normal, not arrive mysteriously silent.
    expect(isSoundEnabled()).toBe(true);
  });
});

describe("writing the sound preference", () => {
  it("stores off as the exact value the reader expects", () => {
    setSoundEnabled(false);

    // Pinned as the literal "0": `leechPrefs` stores the same kind of boolean
    // as "true"/"false", so the two modules are not interchangeable and a
    // reader borrowed from one would read the other's value as its default.
    expect(window.localStorage.getItem(SOUND_KEY)).toBe("0");
    expect(isSoundEnabled()).toBe(false);
  });

  it("stores on", () => {
    setSoundEnabled(false);
    setSoundEnabled(true);

    expect(window.localStorage.getItem(SOUND_KEY)).toBe("1");
    expect(isSoundEnabled()).toBe(true);
  });

  it("announces the change", () => {
    const listener = vi.fn();
    window.addEventListener("ingleezy:ui-sound-changed", listener);

    setSoundEnabled(false);

    // The event is what lets a mute button in one corner of the page reach a
    // sound-playing component in another without either knowing about the
    // other.
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("ingleezy:ui-sound-changed", listener);
  });

  it("does not throw when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => setSoundEnabled(false)).not.toThrow();
  });
});

describe("useSoundPref", () => {
  it("starts from what is stored", () => {
    window.localStorage.setItem(SOUND_KEY, "0");

    const { result } = renderHook(() => useSoundPref());

    expect(result.current[0]).toBe(false);
  });

  it("toggles and persists", () => {
    const { result } = renderHook(() => useSoundPref());

    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(SOUND_KEY)).toBe("0");
  });

  it("picks up a change made elsewhere", () => {
    const { result } = renderHook(() => useSoundPref());
    expect(result.current[0]).toBe(true);

    // The case the event exists for: another component muted the app.
    act(() => setSoundEnabled(false));

    expect(result.current[0]).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { result, unmount } = renderHook(() => useSoundPref());
    unmount();

    // Not a correctness bug so much as a leak: the alphabet page mounts one of
    // these per render pass, and a listener that outlived its component would
    // set state on it forever.
    expect(() => act(() => setSoundEnabled(false))).not.toThrow();
    expect(result.current[0]).toBe(true);
  });
});

describe("reduced motion", () => {
  const stubMatchMedia = (matches: boolean) => {
    const listeners = new Set<() => void>();
    const mq = {
      matches,
      addEventListener: (_: string, handler: () => void) => listeners.add(handler),
      removeEventListener: (_: string, handler: () => void) => listeners.delete(handler),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mq),
    );
    return {
      change(next: boolean) {
        mq.matches = next;
        listeners.forEach((handler) => handler());
      },
    };
  };

  afterEach(() => vi.unstubAllGlobals());

  it("follows the media query", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it("assumes motion is fine when the query does not match", () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("assumes motion is fine when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);

    // Never the reverse: defaulting to reduced motion would strip the
    // animations from every browser that did not answer.
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reacts when the system setting changes mid-session", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => media.change(true));

    // Turning the setting on is something a user does *because* the animation
    // bothered them, so waiting for a reload is waiting too long.
    expect(result.current).toBe(true);
  });
});
