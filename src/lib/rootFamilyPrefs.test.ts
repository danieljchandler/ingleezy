import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadRootFamiliesEnabled,
  saveRootFamiliesEnabled,
  subscribeRootFamilyPrefs,
} from "./rootFamilyPrefs";

/**
 * Root families — whether a reviewed card shows the other words the learner
 * knows that are built from the same Arabic root.
 *
 * It defaults to *on*, which makes the failure paths matter: a storage error
 * that read as "off" would silently remove the feature for anyone whose
 * browser blocks localStorage, and they would have no way to tell that it had
 * ever existed. Every fallback here therefore lands on true.
 *
 * Like `leechPrefs`, this subscribes to `storage` as well as its own event, so
 * turning the toggle off in a Settings tab reaches a review session already
 * running in another one.
 */

const KEY = "ingleezy:root-families-enabled";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reading the preference", () => {
  it("defaults to on when nothing has been stored", () => {
    expect(loadRootFamiliesEnabled()).toBe(true);
  });

  it("reads a stored off", () => {
    window.localStorage.setItem(KEY, "false");
    expect(loadRootFamiliesEnabled()).toBe(false);
  });

  it("reads a stored on", () => {
    window.localStorage.setItem(KEY, "true");
    expect(loadRootFamiliesEnabled()).toBe(true);
  });

  it("treats an unrecognised value as off", () => {
    // `"1"` is how `uiPrefs` stores its booleans; this module stores
    // `"true"`/`"false"` like `leechPrefs` and `featureHints`. The formats are
    // not interchangeable, which is worth pinning rather than discovering.
    window.localStorage.setItem(KEY, "1");
    expect(loadRootFamiliesEnabled()).toBe(false);
  });

  it("falls back to on when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(loadRootFamiliesEnabled()).toBe(true);
  });
});

describe("writing the preference", () => {
  it("stores the boolean as its own string", () => {
    saveRootFamiliesEnabled(false);

    expect(window.localStorage.getItem(KEY)).toBe("false");
    expect(loadRootFamiliesEnabled()).toBe(false);
  });

  it("round-trips back to on", () => {
    saveRootFamiliesEnabled(false);
    saveRootFamiliesEnabled(true);

    expect(loadRootFamiliesEnabled()).toBe(true);
  });

  it("does not throw when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => saveRootFamiliesEnabled(false)).not.toThrow();
  });
});

describe("subscribing", () => {
  it("fires when the preference is saved", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRootFamilyPrefs(listener);

    saveRootFamiliesEnabled(false);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("fires when another tab changes it", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRootFamilyPrefs(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "false" }));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops firing once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRootFamilyPrefs(listener);

    unsubscribe();
    saveRootFamiliesEnabled(false);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    // Both listeners have to come off, not just the custom one — a leaked
    // `storage` handler outlives every review session the tab ever runs.
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not answer the leech preference's event", () => {
    // Both modules listen on `storage`, which fires for every key. If this one
    // reacted to the other's custom event too, toggling leeches would restart
    // the root-index query for no reason.
    const listener = vi.fn();
    const unsubscribe = subscribeRootFamilyPrefs(listener);

    window.dispatchEvent(new CustomEvent("ingleezy:leech-prefs-changed"));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
