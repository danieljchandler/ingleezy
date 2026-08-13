/**
 * User preference: whether to surface words that share an Arabic root.
 *
 * Disabling hides the "same root" footnote under a reviewed card AND the root
 * chips on My Words. It also stops the root-index query from running at all —
 * the feature costs nothing when it's off, rather than fetching and hiding.
 */
const KEY = "ingleezy:root-families-enabled";
const EVENT = "ingleezy:root-family-prefs-changed";

export function loadRootFamiliesEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return true; // default on
    return raw === "true";
  } catch {
    return true;
  }
}

export function saveRootFamiliesEnabled(enabled: boolean) {
  try {
    localStorage.setItem(KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* no-op */
  }
}

export function subscribeRootFamilyPrefs(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(EVENT, handler as EventListener);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler as EventListener);
    window.removeEventListener("storage", handler);
  };
}
