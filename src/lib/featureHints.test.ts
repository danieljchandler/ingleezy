import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadFeatureHintsEnabled,
  saveFeatureHintsEnabled,
  subscribeFeatureHints,
} from "./featureHints";

/**
 * The on/off switch for the small (i) hint icons.
 *
 * Two things make this worth a test rather than an eyeball. The default is
 * *on*, which means an unset key and an explicitly-disabled key have to be told
 * apart — reading a missing key as `false` would silently hide every hint from
 * every new user. And the change is broadcast on a custom event as well as
 * `storage`, because the setting is toggled in one place and read in dozens of
 * components across the same tab, where `storage` never fires.
 */

const KEY = "ingleezy:feature-hints-enabled";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("reading the preference", () => {
  it("defaults to on when nothing has been chosen", () => {
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadFeatureHintsEnabled()).toBe(true);
  });

  it("reads a saved on", () => {
    localStorage.setItem(KEY, "true");
    expect(loadFeatureHintsEnabled()).toBe(true);
  });

  it("reads a saved off", () => {
    localStorage.setItem(KEY, "false");
    expect(loadFeatureHintsEnabled()).toBe(false);
  });

  it("treats anything unrecognised as off rather than as unset", () => {
    // Only the literal "true" counts as on. A value from an older format, or a
    // half-written one, turns the hints off — visible and recoverable, where
    // defaulting to on would silently ignore a user who turned them off.
    localStorage.setItem(KEY, "1");
    expect(loadFeatureHintsEnabled()).toBe(false);
  });

  it("falls back to on when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    // Private browsing must not strip the app's explanatory affordances.
    expect(loadFeatureHintsEnabled()).toBe(true);
  });
});

describe("writing the preference", () => {
  it("persists both settings as strings", () => {
    saveFeatureHintsEnabled(false);
    expect(localStorage.getItem(KEY)).toBe("false");

    saveFeatureHintsEnabled(true);
    expect(localStorage.getItem(KEY)).toBe("true");
  });

  it("round-trips through the reader", () => {
    saveFeatureHintsEnabled(false);
    expect(loadFeatureHintsEnabled()).toBe(false);

    saveFeatureHintsEnabled(true);
    expect(loadFeatureHintsEnabled()).toBe(true);
  });

  it("does not throw when storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => saveFeatureHintsEnabled(false)).not.toThrow();
  });
});

describe("subscribing to changes", () => {
  it("notifies listeners in the same tab", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeFeatureHints(seen);

    saveFeatureHintsEnabled(false);

    // `storage` only fires in *other* tabs, so without the custom event the
    // hints would keep rendering until a reload.
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("notifies listeners when another tab changes it", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeFeatureHints(seen);

    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "false" }));

    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops notifying once unsubscribed", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeFeatureHints(seen);
    unsubscribe();

    saveFeatureHintsEnabled(false);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    // Both listeners have to come off, or a remounted component leaks one
    // subscription per mount.
    expect(seen).not.toHaveBeenCalled();
  });

  it("notifies every listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = subscribeFeatureHints(first);
    const offSecond = subscribeFeatureHints(second);

    saveFeatureHintsEnabled(false);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    offFirst();
    offSecond();
  });

  it("leaves other listeners alone when one unsubscribes", () => {
    const staying = vi.fn();
    const leaving = vi.fn();
    const offStaying = subscribeFeatureHints(staying);
    const offLeaving = subscribeFeatureHints(leaving);

    offLeaving();
    saveFeatureHintsEnabled(false);

    expect(leaving).not.toHaveBeenCalled();
    expect(staying).toHaveBeenCalledTimes(1);
    offStaying();
  });
});
