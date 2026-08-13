/**
 * Global display preferences for Arabic learning content.
 *
 * Controls what is shown by default across the app:
 *   - Dialect Arabic (primary content)
 *   - Tashkil (Arabic diacritics)
 *   - Formal Arabic (MSA), where available
 *   - English translation, where available
 *
 * Persisted in localStorage; synced across components in the same tab via a
 * custom event, and across tabs via the native `storage` event.
 */

export type DisplayPrefs = {
  showArabic: boolean;   // dialect verse / sentence text
  showTashkil: boolean;  // keep Arabic diacritics
  showFormal: boolean;   // formal Arabic (MSA) row, when available
  showEnglish: boolean;  // English translation row, when available
};

const STORAGE_KEY = "ingleezy:display-prefs";
const EVENT = "ingleezy:display-prefs-changed";

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  showArabic: true,
  showTashkil: true,
  showFormal: false,
  showEnglish: false,
};

export function loadDisplayPrefs(): DisplayPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DISPLAY_PREFS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_DISPLAY_PREFS, ...parsed };
  } catch {
    return DEFAULT_DISPLAY_PREFS;
  }
}

export function saveDisplayPrefs(prefs: DisplayPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* no-op */
  }
}

export function subscribeDisplayPrefs(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(EVENT, handler as EventListener);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler as EventListener);
    window.removeEventListener("storage", handler);
  };
}

/** Strip Arabic diacritics (tashkil) and tatweel from text. */
export function stripTashkil(text: string): string {
  if (!text) return text;
  // U+0610–U+061A, U+064B–U+065F, U+0670, U+06D6–U+06ED, U+0640 (tatweel)
  return text.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
}

/** Apply display prefs to an Arabic string (currently: optional tashkil strip). */
export function applyArabicDisplay(text: string, prefs: Pick<DisplayPrefs, "showTashkil">): string {
  if (!text) return text;
  return prefs.showTashkil ? text : stripTashkil(text);
}
