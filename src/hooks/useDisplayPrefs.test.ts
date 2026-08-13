import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDisplayPrefs } from "./useDisplayPrefs";

/**
 * Which rows of an Arabic passage are shown: dialect text, tashkil, the MSA
 * line, the English line.
 *
 * This is the app's most load-bearing preference. Turning English on makes
 * every reading exercise a translation exercise; leaving tashkil on past the
 * point a learner needs it is the single biggest reason people stall at reading
 * unvocalised text. And it is global — the same four booleans drive the
 * reading library, transcripts and set phrases — so the setting is changed in
 * one place and has to be believed in a dozen others, several of which are
 * mounted at the same time.
 *
 * Hence the two channels: a custom event for the tab that made the change
 * (`storage` never fires there) and `storage` for the others.
 */

const KEY = "ingleezy:display-prefs";

const DEFAULTS = {
  showArabic: true,
  showTashkil: true,
  showFormal: false,
  showEnglish: false,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe("the starting point", () => {
  it("shows the Arabic with its vowels and nothing else", () => {
    const { result } = renderHook(() => useDisplayPrefs());

    // The default is the exercise: dialect Arabic, fully vocalised, with no
    // English to read instead of it.
    expect(result.current.prefs).toEqual(DEFAULTS);
  });

  it("is available on the very first render", () => {
    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, showEnglish: true }));

    const seen: boolean[] = [];
    renderHook(() => {
      const { prefs } = useDisplayPrefs();
      seen.push(prefs.showEnglish);
      return prefs;
    });

    // Read in the state initialiser rather than an effect, so a passage never
    // renders once without its English line and then again with it.
    expect(seen[0]).toBe(true);
  });

  it("keeps the settings a learner already chose", () => {
    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, showTashkil: false }));

    const { result } = renderHook(() => useDisplayPrefs());

    expect(result.current.prefs.showTashkil).toBe(false);
  });

  it("fills in a key an older build never wrote", () => {
    localStorage.setItem(KEY, JSON.stringify({ showEnglish: true }));

    const { result } = renderHook(() => useDisplayPrefs());

    // A stored object missing a field must not read as `undefined` — every
    // consumer treats these as booleans, and `undefined` renders as hidden.
    expect(result.current.prefs).toEqual({ ...DEFAULTS, showEnglish: true });
  });

  it("falls back when the stored value is not readable", () => {
    localStorage.setItem(KEY, "{not json");

    const { result } = renderHook(() => useDisplayPrefs());

    expect(result.current.prefs).toEqual(DEFAULTS);
  });

  it("falls back when storage cannot be read at all", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const { result } = renderHook(() => useDisplayPrefs());

    expect(result.current.prefs).toEqual(DEFAULTS);
  });
});

describe("changing a setting", () => {
  it("applies the change and leaves the rest alone", () => {
    const { result } = renderHook(() => useDisplayPrefs());

    act(() => {
      result.current.update({ showEnglish: true });
    });

    // A patch, not a replacement: the Settings screen has four separate
    // switches and each one writes only its own field.
    expect(result.current.prefs).toEqual({ ...DEFAULTS, showEnglish: true });
  });

  it("persists so the next session starts the same way", () => {
    const { result } = renderHook(() => useDisplayPrefs());

    act(() => {
      result.current.update({ showTashkil: false });
    });

    expect(JSON.parse(localStorage.getItem(KEY)!).showTashkil).toBe(false);
  });

  it("accumulates across several changes", () => {
    const { result } = renderHook(() => useDisplayPrefs());

    act(() => {
      result.current.update({ showEnglish: true });
    });
    act(() => {
      result.current.update({ showFormal: true });
    });

    expect(result.current.prefs).toEqual({ ...DEFAULTS, showEnglish: true, showFormal: true });
  });

  it("still applies when the write fails", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    act(() => {
      result.current.update({ showEnglish: true });
    });

    // The passage in front of the learner honours the switch; only its
    // persistence is lost.
    expect(result.current.prefs.showEnglish).toBe(true);
  });
});

describe("staying in step", () => {
  it("updates every screen that is mounted at once", () => {
    const settings = renderHook(() => useDisplayPrefs());
    const passage = renderHook(() => useDisplayPrefs());

    act(() => {
      settings.result.current.update({ showEnglish: true });
    });

    // The switch lives in Settings and the text it governs is somewhere else
    // entirely; without the broadcast the passage keeps its old layout until
    // it is remounted.
    expect(passage.result.current.prefs.showEnglish).toBe(true);
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useDisplayPrefs());

    act(() => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, showEnglish: true }));
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });

    expect(result.current.prefs.showEnglish).toBe(true);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = renderHook(() => useDisplayPrefs());
    unmount();

    // A leaked listener sets state on an unmounted tree every time the setting
    // moves, for the life of the tab.
    expect(() =>
      act(() => {
        window.dispatchEvent(new CustomEvent("ingleezy:display-prefs-changed"));
      }),
    ).not.toThrow();
  });
});
