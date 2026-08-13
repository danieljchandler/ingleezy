import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PostHog analytics.
 *
 * The assertions that matter here are the ones about *not* sending anything.
 * The module reads its key from `import.meta.env` at load time and every entry
 * point is a no-op without it, so the interesting cases are the two ways it is
 * supposed to stay dormant — no key configured, and Do Not Track set — plus the
 * guarantee that `track()` before `initAnalytics()` is silent rather than a
 * crash, since components call it from render paths that run long before auth
 * has resolved.
 *
 * Everything goes through a fresh import: the client handle and the in-flight
 * init promise are module state, and a test that inherited either from the one
 * before it would be asserting on the wrong thing.
 */

/** A stand-in for the posthog-js module, recording what it was asked to do. */
function fakePostHog() {
  return {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
  };
}

let client: ReturnType<typeof fakePostHog>;

/**
 * Import the module fresh with `posthog-js` mocked out.
 *
 * The real package is never loaded — it is a network-touching dependency that
 * this suite has no business pulling in, and the dynamic import is the seam
 * that makes stubbing it possible.
 */
async function loadAnalytics() {
  vi.resetModules();
  client = fakePostHog();
  vi.doMock("posthog-js", () => ({ default: client }));
  return import("./analytics");
}

beforeEach(() => {
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
    cb();
    return 1;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("posthog-js");
  vi.restoreAllMocks();
});

describe("staying dormant", () => {
  it("is disabled when no key is configured", async () => {
    // vitest.config.ts sets no VITE_POSTHOG_KEY, which is the shipped default
    // for anyone running this app without analytics.
    const analytics = await loadAnalytics();

    expect(analytics.isAnalyticsEnabled()).toBe(false);
  });

  it("loads nothing at all without a key", async () => {
    const analytics = await loadAnalytics();

    await analytics.initAnalytics();

    // Not merely "sends no events": the posthog bundle is never fetched, which
    // is the difference between a dormant integration and a silent one.
    expect(client.init).not.toHaveBeenCalled();
  });

  it("is disabled when Do Not Track is set", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    vi.stubGlobal("navigator", { ...navigator, doNotTrack: "1" });

    const analytics = await loadAnalytics();

    // The browser-level answer wins over the app's configuration, and it is
    // checked before anything is loaded rather than passed to posthog to
    // honour later.
    expect(analytics.isAnalyticsEnabled()).toBe(false);
  });

  it("accepts the legacy 'yes' spelling of Do Not Track", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    vi.stubGlobal("navigator", { ...navigator, doNotTrack: "yes" });

    const analytics = await loadAnalytics();

    expect(analytics.isAnalyticsEnabled()).toBe(false);
  });

  it("tracks nothing before init", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    const analytics = await loadAnalytics();

    analytics.track("lesson_started", { lessonId: "l1" });
    analytics.identify("u1");
    analytics.resetAnalytics();

    // Components call `track` from render paths that run long before
    // `initAnalytics` — this has to be a no-op, not a crash and not a queue.
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
    expect(client.reset).not.toHaveBeenCalled();
  });
});

describe("once enabled", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    vi.stubGlobal("navigator", { ...navigator, doNotTrack: null });
  });

  it("is enabled with a key and no Do Not Track", async () => {
    const analytics = await loadAnalytics();

    expect(analytics.isAnalyticsEnabled()).toBe(true);
  });

  it("initialises with privacy-preserving options", async () => {
    const analytics = await loadAnalytics();

    await analytics.initAnalytics();

    // These four are the privacy posture, not tuning: no session replay, no
    // autocapture of every click, profiles only for identified users, and DNT
    // respected a second time inside posthog itself.
    expect(client.init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({
        disable_session_recording: true,
        autocapture: false,
        person_profiles: "identified_only",
        respect_dnt: true,
      }),
    );
  });

  it("sends to the EU host by default", async () => {
    const analytics = await loadAnalytics();

    await analytics.initAnalytics();

    expect(client.init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({ api_host: "https://eu.i.posthog.com" }),
    );
  });

  it("initialises only once however many callers ask", async () => {
    const analytics = await loadAnalytics();

    await Promise.all([
      analytics.initAnalytics(),
      analytics.initAnalytics(),
      analytics.initAnalytics(),
    ]);
    await analytics.initAnalytics();

    // The in-flight promise is shared, so concurrent callers during startup do
    // not each load and configure a client.
    expect(client.init).toHaveBeenCalledTimes(1);
  });

  it("captures an event after init", async () => {
    const analytics = await loadAnalytics();
    await analytics.initAnalytics();

    analytics.track("lesson_started", { lessonId: "l1" });

    expect(client.capture).toHaveBeenCalledWith("lesson_started", { lessonId: "l1" });
  });

  it("identifies a user after init", async () => {
    const analytics = await loadAnalytics();
    await analytics.initAnalytics();

    analytics.identify("u1", { tier: "standard" });

    expect(client.identify).toHaveBeenCalledWith("u1", { tier: "standard" });
  });

  it("resets on sign-out", async () => {
    const analytics = await loadAnalytics();
    await analytics.initAnalytics();

    analytics.resetAnalytics();

    // Without this the next person to sign in on a shared device is attributed
    // to the previous one.
    expect(client.reset).toHaveBeenCalledTimes(1);
  });
});

describe("when the client misbehaves", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    vi.stubGlobal("navigator", { ...navigator, doNotTrack: null });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("carries on when the bundle will not load", async () => {
    vi.resetModules();
    vi.doMock("posthog-js", () => {
      throw new Error("network down");
    });
    const analytics = await import("./analytics");

    // An ad blocker eating the request is the common case, and analytics
    // failing must never take the page with it.
    await expect(analytics.initAnalytics()).resolves.toBeNull();
  });

  it("swallows a throwing capture", async () => {
    const analytics = await loadAnalytics();
    await analytics.initAnalytics();
    client.capture.mockImplementation(() => {
      throw new Error("capture failed");
    });

    expect(() => analytics.track("lesson_started")).not.toThrow();
  });

  it("swallows a throwing identify", async () => {
    const analytics = await loadAnalytics();
    await analytics.initAnalytics();
    client.identify.mockImplementation(() => {
      throw new Error("identify failed");
    });

    expect(() => analytics.identify("u1")).not.toThrow();
  });

  it("swallows a throwing reset", async () => {
    const analytics = await loadAnalytics();
    await analytics.initAnalytics();
    client.reset.mockImplementation(() => {
      throw new Error("reset failed");
    });

    // Reset is called during sign-out; throwing here would strand the learner
    // half signed out.
    expect(() => analytics.resetAnalytics()).not.toThrow();
  });
});
