/**
 * User preference: whether to show the small (i) feature-hint icons
 * sprinkled across the app. Default: ON.
 */
const KEY = "hakiya:feature-hints-enabled";
const EVENT = "hakiya:feature-hints-changed";

export function loadFeatureHintsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

export function saveFeatureHintsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* no-op */
  }
}

export function subscribeFeatureHints(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(EVENT, handler as EventListener);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler as EventListener);
    window.removeEventListener("storage", handler);
  };
}
