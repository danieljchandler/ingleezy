/**
 * User preference: whether to flag cards as "leeches" after repeated failures.
 * Disabling stops new leech flagging AND hides the helper panel on already-flagged cards.
 */
const KEY = "hakiya:leech-tracking-enabled";
const EVENT = "hakiya:leech-prefs-changed";

export function loadLeechTrackingEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return true; // default on
    return raw === "true";
  } catch {
    return true;
  }
}

export function saveLeechTrackingEnabled(enabled: boolean) {
  try {
    localStorage.setItem(KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* no-op */
  }
}

export function subscribeLeechPrefs(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(EVENT, handler as EventListener);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler as EventListener);
    window.removeEventListener("storage", handler);
  };
}
