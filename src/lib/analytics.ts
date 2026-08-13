/**
 * PostHog analytics — lazy-loaded, EU-hosted, gated on VITE_POSTHOG_KEY.
 *
 * Ships dormant if the key is absent. Respects Do Not Track. Init is deferred
 * until after first paint so it never blocks the critical path.
 *
 * Usage:
 *   import { track, identify, initAnalytics } from "@/lib/analytics";
 *   initAnalytics();           // call once after auth resolved
 *   track("lesson_started", { lessonId });
 */

type PostHogLike = {
  init: (key: string, opts: Record<string, unknown>) => void;
  capture: (event: string, props?: Record<string, unknown>) => void;
  identify: (id: string, props?: Record<string, unknown>) => void;
  reset: () => void;
};

let ph: PostHogLike | null = null;
let initPromise: Promise<PostHogLike | null> | null = null;

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://eu.i.posthog.com";

function dntEnabled(): boolean {
  try {
    const v =
      navigator.doNotTrack ||
      // @ts-expect-error legacy
      window.doNotTrack ||
      // @ts-expect-error legacy
      navigator.msDoNotTrack;
    return v === "1" || v === "yes";
  } catch {
    return false;
  }
}

export function isAnalyticsEnabled(): boolean {
  return Boolean(KEY) && !dntEnabled();
}

export async function initAnalytics(): Promise<PostHogLike | null> {
  if (!isAnalyticsEnabled()) return null;
  if (ph) return ph;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Defer until after first paint so analytics never blocks LCP.
      await new Promise<void>((r) =>
        "requestIdleCallback" in window
          ? (window as any).requestIdleCallback(() => r(), { timeout: 2000 })
          : setTimeout(r, 1500),
      );
      const mod = await import("posthog-js");
      const client = (mod.default ?? mod) as unknown as PostHogLike;
      client.init(KEY!, {
        api_host: HOST,
        person_profiles: "identified_only",
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: false,
        disable_session_recording: true,
        respect_dnt: true,
      });
      ph = client;
      return client;
    } catch (err) {
      console.warn("[analytics] init failed (continuing without):", err);
      return null;
    }
  })();

  return initPromise;
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (!ph) return;
  try {
    ph.capture(event, props);
  } catch (err) {
    console.warn("[analytics] track failed:", err);
  }
}

export function identify(userId: string, props?: Record<string, unknown>): void {
  if (!ph) return;
  try {
    ph.identify(userId, props);
  } catch (err) {
    console.warn("[analytics] identify failed:", err);
  }
}

export function resetAnalytics(): void {
  if (!ph) return;
  try {
    ph.reset();
  } catch {
    // ignore
  }
}
