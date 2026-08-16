/**
 * Dark mode — brand-guide palette, Gen-Z expectation, video-app default.
 *
 * The `.dark` token block sat in index.css with nothing ever applying the
 * class, so dark mode was dead CSS. Three states now: an explicit choice
 * stored under `ingleezy:theme`, or "system", which follows
 * `prefers-color-scheme` live. Applied before first paint from main.tsx so
 * there is no light flash on a dark device.
 */

export type ThemePreference = "light" | "dark" | "system";

const KEY = "ingleezy:theme";

export function getThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    /* storage unavailable → system */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/** The mode actually in effect once "system" is resolved. */
export function resolvedTheme(pref: ThemePreference = getThemePreference()): "light" | "dark" {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

function apply(pref: ThemePreference) {
  const dark = resolvedTheme(pref) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  // Keep the browser chrome (address bar, status bar) on-brand per mode.
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute("content", dark ? "#1B2534" : "#FAFBFD");
}

export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable — still apply for this session */
  }
  apply(pref);
}

/** Call once at startup, before render. Returns an unsubscribe for tests. */
export function initTheme(): () => void {
  apply(getThemePreference());
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!media?.addEventListener) return () => {};
  const onChange = () => {
    // Only "system" follows the OS; an explicit choice stays put.
    if (getThemePreference() === "system") apply("system");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
