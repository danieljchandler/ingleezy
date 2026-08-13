import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyArabicDisplay,
  DEFAULT_DISPLAY_PREFS,
  loadDisplayPrefs,
  saveDisplayPrefs,
  stripTashkil,
  subscribeDisplayPrefs,
} from "./displayPrefs";

/**
 * What Arabic content the learner sees by default.
 *
 * Two things here are easy to break. The preferences were originally
 * Bible-only and were promoted to a global setting, so there is a migration
 * from the old key that has to keep working for anyone who set them before the
 * change. And `stripTashkil` removes diacritics by Unicode range — a range
 * that is slightly wrong deletes letters rather than marks, which corrupts the
 * word silently rather than failing.
 */

const STORAGE_KEY = "hakiya:display-prefs";
const LEGACY_KEY = "hakiya:bible-display-prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("defaults", () => {
  it("shows the dialect Arabic with its diacritics, and nothing else", () => {
    expect(loadDisplayPrefs()).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(DEFAULT_DISPLAY_PREFS).toEqual({
      showArabic: true,
      showTashkil: true,
      showFormal: false,
      showEnglish: false,
    });
  });
});

describe("persistence", () => {
  it("round-trips a saved set", () => {
    saveDisplayPrefs({ ...DEFAULT_DISPLAY_PREFS, showEnglish: true, showTashkil: false });

    expect(loadDisplayPrefs()).toMatchObject({ showEnglish: true, showTashkil: false });
  });

  it("fills in keys a stored set is missing", () => {
    // A preference added after someone saved theirs must not come back
    // undefined, which would render as neither on nor off.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showEnglish: true }));

    const prefs = loadDisplayPrefs();
    expect(prefs.showEnglish).toBe(true);
    expect(prefs.showArabic).toBe(true);
    expect(prefs.showTashkil).toBe(true);
  });

  it("falls back to the defaults on unparseable storage", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadDisplayPrefs()).toEqual(DEFAULT_DISPLAY_PREFS);
  });

  it("does not throw when storage refuses to write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => saveDisplayPrefs(DEFAULT_DISPLAY_PREFS)).not.toThrow();
  });
});

describe("migrating from the Bible-only key", () => {
  it("adopts settings saved before the preference went global", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ showEnglish: true, showTashkil: false }));

    expect(loadDisplayPrefs()).toMatchObject({ showEnglish: true, showTashkil: false });
  });

  it("copies them to the new key, so the migration happens once", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ showEnglish: true }));

    loadDisplayPrefs();

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      showEnglish: true,
    });
  });

  it("prefers the new key when both exist", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ showEnglish: true }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showEnglish: false }));

    expect(loadDisplayPrefs().showEnglish).toBe(false);
  });

  it("keeps writing the legacy key, for readers that have not migrated", () => {
    saveDisplayPrefs({ ...DEFAULT_DISPLAY_PREFS, showFormal: true });

    expect(JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}")).toMatchObject({
      showFormal: true,
    });
  });
});

describe("subscribing", () => {
  it("notifies on a change in this tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDisplayPrefs(listener);

    saveDisplayPrefs(DEFAULT_DISPLAY_PREFS);

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("notifies on a change from another tab", () => {
    // The native storage event only fires cross-tab, which is why both are
    // listened for.
    const listener = vi.fn();
    const unsubscribe = subscribeDisplayPrefs(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying once unsubscribed", () => {
    const listener = vi.fn();
    subscribeDisplayPrefs(listener)();

    saveDisplayPrefs(DEFAULT_DISPLAY_PREFS);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("stripTashkil", () => {
  it("removes the short-vowel marks", () => {
    // كَتَبَ -> كتب
    expect(stripTashkil("كَتَبَ")).toBe("كتب");
  });

  it("removes shadda and sukun", () => {
    expect(stripTashkil("مُدَرِّسٌ")).toBe("مدرس");
  });

  it("removes tatweel, which is decorative stretching rather than a letter", () => {
    expect(stripTashkil("كــتــب")).toBe("كتب");
  });

  it("removes the dagger alif", () => {
    // U+0670, which sits in its own range away from the other marks.
    expect(stripTashkil("هَٰذَا")).toBe("هذا");
  });

  it("leaves hamza and madda alone — they are part of the letter", () => {
    // The most dangerous kind of over-stripping: أ إ آ ؤ ئ are distinct
    // letters, and removing their marks changes the word rather than its
    // vocalisation.
    for (const letter of ["أ", "إ", "آ", "ؤ", "ئ", "ء", "ة", "ى"]) {
      expect(stripTashkil(letter)).toBe(letter);
    }
  });

  it("leaves an undiacritised word untouched", () => {
    expect(stripTashkil("مرحبا")).toBe("مرحبا");
  });

  it("leaves Latin text, digits and punctuation untouched", () => {
    expect(stripTashkil("Hello, world 123!")).toBe("Hello, world 123!");
  });

  it("handles empty and whitespace input", () => {
    expect(stripTashkil("")).toBe("");
    expect(stripTashkil("   ")).toBe("   ");
  });
});

describe("applyArabicDisplay", () => {
  it("keeps the diacritics when they are switched on", () => {
    expect(applyArabicDisplay("كَتَبَ", { showTashkil: true })).toBe("كَتَبَ");
  });

  it("strips them when they are switched off", () => {
    expect(applyArabicDisplay("كَتَبَ", { showTashkil: false })).toBe("كتب");
  });

  it("passes empty text through either way", () => {
    expect(applyArabicDisplay("", { showTashkil: false })).toBe("");
  });
});
