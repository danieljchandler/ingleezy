import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared loader for the YouTube IFrame API.
 *
 * This file exists because `window.onYouTubeIframeAPIReady` is a *single*
 * global callback. Two components that each assign it independently do not both
 * get called — the last assignment wins, and the loser's player is never
 * constructed, so whatever was awaiting it hangs with no error anywhere. The
 * Discover feed and the video admin form both embed players, so that collision
 * is reachable in normal use.
 *
 * The module caches its promise at module scope, which is the mechanism that
 * makes it safe. Every test therefore re-imports it fresh.
 */

type YouTubeWindow = {
  YT?: { Player: unknown };
  onYouTubeIframeAPIReady?: () => void;
};

const w = () => window as unknown as YouTubeWindow;

async function freshLoader() {
  vi.resetModules();
  const mod = await import("./youtubeIframeApi");
  return mod.loadYouTubeIframeAPI;
}

/** The script tag the loader appends, if it appended one. */
const injected = () =>
  Array.from(document.head.querySelectorAll("script")).filter((s) =>
    s.src.includes("youtube.com/iframe_api"),
  );

beforeEach(() => {
  delete w().YT;
  delete w().onYouTubeIframeAPIReady;
  document.head.querySelectorAll("script").forEach((s) => s.remove());
});

afterEach(() => {
  delete w().YT;
  delete w().onYouTubeIframeAPIReady;
});

describe("loading the API", () => {
  it("injects the script once", async () => {
    const load = await freshLoader();
    load();

    expect(injected()).toHaveLength(1);
    expect(injected()[0].src).toBe("https://www.youtube.com/iframe_api");
  });

  it("resolves when YouTube calls the global ready callback", async () => {
    const load = await freshLoader();
    const ready = load();

    let settled = false;
    void ready.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    w().onYouTubeIframeAPIReady?.();
    await ready;

    expect(settled).toBe(true);
  });

  it("resolves immediately when the API is already on the page", async () => {
    w().YT = { Player: class {} };
    const load = await freshLoader();

    // A second visit to a video page inside one session: the script is already
    // loaded and no ready callback will ever fire again.
    await expect(load()).resolves.toBeUndefined();
    expect(injected()).toHaveLength(0);
  });

  it("does not treat a half-initialised YT global as ready", async () => {
    // The script assigns `window.YT` before it finishes wiring `YT.Player`, so
    // a check on `YT` alone resolves into a window where constructing a player
    // throws.
    w().YT = {} as { Player: unknown };
    const load = await freshLoader();
    load();

    expect(injected()).toHaveLength(1);
  });
});

describe("sharing one load between callers", () => {
  it("injects the script once no matter how many callers ask", async () => {
    const load = await freshLoader();
    load();
    load();
    load();

    expect(injected()).toHaveLength(1);
  });

  it("hands every caller the same promise", async () => {
    const load = await freshLoader();

    expect(load()).toBe(load());
  });

  it("resolves every waiting caller from the single global callback", async () => {
    const load = await freshLoader();
    const first = load();
    const second = load();
    const third = load();

    // This is the whole point of the module: three components, one callback,
    // and none of them silently starved.
    w().onYouTubeIframeAPIReady?.();

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("keeps resolving after the API has loaded", async () => {
    const load = await freshLoader();
    const first = load();
    w().onYouTubeIframeAPIReady?.();
    await first;

    // A player mounted later in the session must not wait on a callback that
    // has already fired.
    await expect(load()).resolves.toBeUndefined();
    expect(injected()).toHaveLength(1);
  });
});
