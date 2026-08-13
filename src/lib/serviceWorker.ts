/**
 * Service worker registration.
 *
 * Registered in production builds only. The Playwright suite runs against the
 * dev server and is hermetic — it answers every Supabase request from fixtures
 * at a fake host — so a service worker sitting in front of those requests would
 * make the suite non-deterministic for no benefit. Dev reloads have the same
 * problem in a smaller way.
 *
 * Also actively unregisters any worker left behind on a dev/preview origin, so
 * a developer who once loaded a production build on localhost isn't stuck
 * being served a stale shell.
 */

const SW_URL = "/sw.js";

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  if (!import.meta.env.PROD) {
    void unregisterServiceWorker();
    return;
  }

  // Register after load so it never competes with first paint.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(SW_URL).catch((err) => {
      // A failed registration costs nothing but offline support.
      console.warn("Service worker registration failed:", err);
    });
  });
}

export async function unregisterServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  } catch {
    // Nothing to clean up.
  }
}
