import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLoopingVideo } from "./useLoopingVideo";

/**
 * The decorative looping clips — the loading emblem and the caravan medallion.
 *
 * They are artwork, not content: nobody pressed play, so every browser applies
 * its autoplay policy and each one applies it differently. Safari refuses
 * unless `muted` is a real DOM property rather than a JSX attribute; a rejected
 * play() is a promise rejection that would otherwise surface as an unhandled
 * error on a purely decorative element.
 *
 * Two things then have to be true. Anyone who asked their system for reduced
 * motion sees a still, and never pays to download or decode the clip. And when
 * the clip cannot play — blocked, missing, an unsupported codec — the poster
 * takes its place rather than leaving a black rectangle.
 */

const originalMatchMedia = window.matchMedia;

/** A matchMedia that answers a specific query, unlike the always-false stub. */
function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

/** A <video> whose play() resolves or rejects on demand. */
function aVideo(play: () => Promise<void> = () => Promise.resolve()) {
  const element = document.createElement("video");
  element.play = vi.fn(play) as unknown as HTMLVideoElement["play"];
  element.pause = vi.fn();
  return element;
}

const playCalls = (video: HTMLVideoElement) =>
  (video.play as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

/**
 * Mount the hook with a <video> already attached.
 *
 * The ref is assigned in the render body rather than afterwards, because React
 * attaches a real ref during commit — before effects run. Attaching it after
 * the first render and re-rendering would never re-run the effect (its only
 * dependency is `still`), so the play would never be attempted and every
 * assertion here would describe an element the hook had not seen.
 */
function render(play?: () => Promise<void>) {
  const video = aVideo(play);
  const harness = renderHook(() => {
    const api = useLoopingVideo();
    (api.videoRef as { current: HTMLVideoElement | null }).current = video;
    return api;
  });
  return { ...harness, video };
}

beforeEach(() => {
  reducedMotion(false);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

describe("starting the clip", () => {
  it("plays it once the element is attached", () => {
    const { video } = render();

    expect(video.play).toHaveBeenCalled();
  });

  it("mutes it as a DOM property, not just an attribute", () => {
    const { video } = render();

    // Safari's autoplay policy reads the property. Setting `muted` in JSX alone
    // leaves it unset at the moment play() is called, and the play is rejected
    // — which is how the emblem ends up as a still on iPhones only.
    expect(video.muted).toBe(true);
  });

  it("shows the clip rather than the poster by default", () => {
    const { result } = renderHook(() => useLoopingVideo());

    expect(result.current.still).toBe(false);
  });
});

describe("when the clip cannot play", () => {
  it("falls back to the poster when the browser blocks autoplay", async () => {
    const { result } = render(() => Promise.reject(new Error("NotAllowedError")));

    await act(async () => {});

    // A blocked autoplay leaves a frozen first frame or a black box. The poster
    // is the same artwork and is what the caller intended to show anyway.
    expect(result.current.still).toBe(true);
  });

  it("falls back to the poster when no source is playable", () => {
    const { result } = renderHook(() => useLoopingVideo());

    act(() => {
      result.current.onSourceError();
    });

    // Fired from the *last* <source>: the browser walks the list in order, so
    // an earlier one erroring only means it moved on to the next.
    expect(result.current.still).toBe(true);
  });

  it("stays on the poster once it has given up", async () => {
    const { rerender, video } = render(() => Promise.reject(new Error("NotAllowedError")));

    await act(async () => {});
    const callsBefore = playCalls(video);
    rerender();

    // Retrying on every render would be a loop of rejected promises for as long
    // as the component is mounted.
    expect(playCalls(video)).toBe(callsBefore);
  });
});

describe("respecting reduced motion", () => {
  it("shows the still and never touches the video", () => {
    reducedMotion(true);

    const { result, video } = render();

    // Skipped entirely rather than paused: no download, no decode. Someone who
    // asked their system for reduced motion usually meant it for a reason.
    expect(result.current.still).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
  });
});

describe("while the tab is in the background", () => {
  it("pauses the loop when the tab is hidden", () => {
    const { video } = render();

    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Most browsers do this for us; Android WebView does not always, and a clip
    // decoding behind a background tab is real battery on the device most of
    // this app's learners use.
    expect(video.pause).toHaveBeenCalled();
  });

  it("resumes when the tab comes back", () => {
    const { video } = render();
    const callsBefore = playCalls(video);

    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(playCalls(video)).toBeGreaterThan(callsBefore);
  });

  it("does not fall back to the poster when a resume is refused", async () => {
    let attempt = 0;
    const { result } = render(() =>
      ++attempt === 1 ? Promise.resolve() : Promise.reject(new Error("NotAllowedError")),
    );
    await act(async () => {});

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The clip already played once, so a refused resume is a transient policy
    // decision rather than a clip that cannot play — swapping in the poster
    // here would make the emblem stop animating for the rest of the session
    // because the learner switched tabs.
    expect(result.current.still).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { unmount, video } = render();
    unmount();

    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The emblem mounts on every route transition, so a leaked listener per
    // navigation would pause a dozen dead elements on the first tab switch.
    expect(video.pause).not.toHaveBeenCalled();
  });
});
