import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getThemePreference, initTheme, resolvedTheme, setThemePreference } from "./theme";

/**
 * Dark mode is three states, not two: an explicit choice survives everything,
 * and "system" follows the OS live. The failure this guards against is the
 * classic one — a `.dark` token block that nothing ever applies, which is
 * exactly what this app shipped with until the brand pass.
 */

let systemDark = false;
let mediaListeners: Array<() => void> = [];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  systemDark = false;
  mediaListeners = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") ? systemDark : false,
    addEventListener: (_: string, fn: () => void) => mediaListeners.push(fn),
    removeEventListener: (_: string, fn: () => void) => {
      mediaListeners = mediaListeners.filter((l) => l !== fn);
    },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

describe("theme preference", () => {
  it("defaults to system when nothing is stored", () => {
    expect(getThemePreference()).toBe("system");
  });

  it("applies the system preference on init", () => {
    systemDark = true;
    initTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("lets an explicit choice override the system", () => {
    systemDark = true;
    setThemePreference("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(resolvedTheme()).toBe("light");
  });

  it("follows the OS live only in system mode", () => {
    const unsub = initTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    systemDark = true;
    mediaListeners.forEach((fn) => fn());
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // An explicit choice pins the theme; later OS flips must not move it.
    setThemePreference("light");
    systemDark = false;
    systemDark = true;
    mediaListeners.forEach((fn) => fn());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    unsub();
  });

  it("returns to following the system when the choice is cleared", () => {
    setThemePreference("dark");
    expect(localStorage.getItem("ingleezy:theme")).toBe("dark");
    systemDark = false;
    setThemePreference("system");
    expect(localStorage.getItem("ingleezy:theme")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
