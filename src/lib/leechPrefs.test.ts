import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadLeechTrackingEnabled,
  saveLeechTrackingEnabled,
  subscribeLeechPrefs,
} from "./leechPrefs";

/**
 * Leech tracking — whether a card that keeps being failed gets flagged.
 *
 * Two things make this worth a test despite its size. It defaults to *on*, so
 * every failure path has to keep it on rather than quietly disabling a review
 * aid the learner never turned off. And it is the one preference in the app
 * that subscribes to the `storage` event as well as its own, which is what
 * makes a change in one tab reach the review session running in another.
 */

const KEY = "ingleezy:leech-tracking-enabled";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reading the preference", () => {
  it("defaults to on when nothing has been stored", () => {
    expect(loadLeechTrackingEnabled()).toBe(true);
  });

  it("reads a stored off", () => {
    window.localStorage.setItem(KEY, "false");
    expect(loadLeechTrackingEnabled()).toBe(false);
  });

  it("reads a stored on", () => {
    window.localStorage.setItem(KEY, "true");
    expect(loadLeechTrackingEnabled()).toBe(true);
  });

  it("treats an unrecognised value as off", () => {
    // The comparison is `raw === "true"`. Notably `"1"` — which is how
    // `uiPrefs` stores its own booleans — reads as off here, so the two
    // modules' formats are not interchangeable despite storing the same kind
    // of thing.
    window.localStorage.setItem(KEY, "1");
    expect(loadLeechTrackingEnabled()).toBe(false);
  });

  it("falls back to on when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    // Disabling this hides the helper panel on cards already flagged as
    // leeches, so a storage failure that read as "off" would remove review
    // help the learner had been relying on.
    expect(loadLeechTrackingEnabled()).toBe(true);
  });
});

describe("writing the preference", () => {
  it("stores the boolean as its own string", () => {
    saveLeechTrackingEnabled(false);

    expect(window.localStorage.getItem(KEY)).toBe("false");
    expect(loadLeechTrackingEnabled()).toBe(false);
  });

  it("round-trips back to on", () => {
    saveLeechTrackingEnabled(false);
    saveLeechTrackingEnabled(true);

    expect(loadLeechTrackingEnabled()).toBe(true);
  });

  it("does not throw when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => saveLeechTrackingEnabled(false)).not.toThrow();
  });
});

describe("subscribing", () => {
  it("fires when the preference is saved", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLeechPrefs(listener);

    saveLeechTrackingEnabled(false);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("fires when another tab changes it", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLeechPrefs(listener);

    // `storage` only fires in *other* documents, so this is the cross-tab
    // path: settings open in one tab, a review session running in another.
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "false" }));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops firing once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLeechPrefs(listener);

    unsubscribe();
    saveLeechTrackingEnabled(false);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    // Both listeners have to come off, not just the custom one — a leaked
    // `storage` handler outlives every review session the tab ever runs.
    expect(listener).not.toHaveBeenCalled();
  });

  it("lets several subscribers watch at once", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeLeechPrefs(first);
    const stopSecond = subscribeLeechPrefs(second);

    saveLeechTrackingEnabled(false);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    stopSecond();
  });

  it("leaves the other subscribers alone when one unsubscribes", () => {
    const staying = vi.fn();
    const leaving = vi.fn();
    const stopStaying = subscribeLeechPrefs(staying);
    const stopLeaving = subscribeLeechPrefs(leaving);

    stopLeaving();
    saveLeechTrackingEnabled(false);

    expect(leaving).not.toHaveBeenCalled();
    expect(staying).toHaveBeenCalledTimes(1);
    stopStaying();
  });
});
