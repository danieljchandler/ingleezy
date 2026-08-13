import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractFramesWithTimestamps } from "./videoFrameExtractor";

/**
 * Sampling frames out of an uploaded video.
 *
 * This is the input to the meme analyser: the on-screen text is read from these
 * frames, and `process-approved-video` refuses to transcribe a meme without
 * them. So which instants get sampled decides whether the joke is legible at
 * all — and meme captions live disproportionately on the very first and very
 * last frames, which is why the sampler reaches for both ends rather than
 * walking the interior at a fixed step.
 *
 * jsdom has no video decoder and no canvas, so both are stubbed. What is under
 * test is the timestamp arithmetic, the scaling, and the object-URL lifecycle —
 * a leaked blob URL pins the whole video in memory for the life of the tab.
 */

interface FakeVideo extends Partial<HTMLVideoElement> {
  onloadedmetadata: (() => void) | null;
  onseeked: (() => void) | null;
  onerror: (() => void) | null;
}

let video: FakeVideo;
let drawn: number;
let created: string[];
let revoked: string[];
let canvasSize: { width: number; height: number };

function setup({
  duration = 12,
  videoWidth = 1920,
  videoHeight = 1080,
}: { duration?: number; videoWidth?: number; videoHeight?: number } = {}) {
  drawn = 0;
  created = [];
  revoked = [];
  canvasSize = { width: 0, height: 0 };

  video = {
    duration,
    videoWidth,
    videoHeight,
    currentTime: 0,
    onloadedmetadata: null,
    onseeked: null,
    onerror: null,
  } as FakeVideo;

  // Seeking resolves on the next tick, as a real decoder would.
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => (video as unknown as { _t: number })._t ?? 0,
    set(value: number) {
      (video as unknown as { _t: number })._t = value;
      queueMicrotask(() => video.onseeked?.());
    },
  });

  const canvas = {
    set width(value: number) {
      canvasSize.width = value;
    },
    get width() {
      return canvasSize.width;
    },
    set height(value: number) {
      canvasSize.height = value;
    },
    get height() {
      return canvasSize.height;
    },
    getContext: () => ({
      drawImage: () => {
        drawn += 1;
      },
    }),
    toDataURL: () => "data:image/jpeg;base64,ZmFrZQ==",
  };

  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag === "video") return video as unknown as HTMLElement;
    if (tag === "canvas") return canvas as unknown as HTMLElement;
    return document.createElement.bind(document)(tag);
  }) as typeof document.createElement);

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn((..._args: unknown[]) => {
      const url = `blob:fake-${created.length}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url);
    }),
  });
}

/** Kick the metadata handler once the extractor has attached it. */
async function loaded() {
  await Promise.resolve();
  video.onloadedmetadata?.();
}

const aFile = () => ({ name: "meme.mp4", type: "video/mp4" }) as unknown as File;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("choosing the timestamps", () => {
  it("samples across the clip at roughly the requested interval", async () => {
    setup({ duration: 12 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20);
    await loaded();

    const frames = await promise;

    // ceil(12 / 4) + 1 = 4 samples.
    expect(frames).toHaveLength(4);
    expect(drawn).toBe(4);
  });

  it("reaches for both ends rather than the interior", async () => {
    setup({ duration: 12 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20);
    await loaded();

    const frames = await promise;
    const times = frames.map((f) => f.timestampSeconds);

    // Meme captions cluster on the opening and closing frames; a sampler that
    // started at the first interval boundary would miss both.
    expect(times[0]).toBeLessThanOrEqual(0.3);
    expect(times.at(-1)).toBeGreaterThan(11);
  });

  it("keeps the last sample inside the file", async () => {
    setup({ duration: 12 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20);
    await loaded();

    const frames = await promise;

    // Seeking to exactly `duration` never fires `seeked` in some browsers, so
    // the extractor would hang rather than finish.
    expect(frames.at(-1)!.timestampSeconds).toBeLessThan(12);
  });

  it("takes at least three samples from anything longer than two seconds", async () => {
    setup({ duration: 3 });
    const promise = extractFramesWithTimestamps(aFile(), 30, 20);
    await loaded();

    // A 30-second interval over a 3-second clip would otherwise yield one
    // frame, and one frame of a meme is usually the wrong one.
    expect(await promise).toHaveLength(3);
  });

  it("still takes two samples from a clip shorter than the interval", async () => {
    setup({ duration: 1.5 });
    const promise = extractFramesWithTimestamps(aFile(), 30, 20);
    await loaded();

    // `ceil(duration / interval) + 1` is never below 2, so the sub-two-second
    // floor of 1 never applies — the count is 2 whatever the clip length.
    expect(await promise).toHaveLength(2);
  });

  it("takes a single mid-point sample only when the cap says one", async () => {
    setup({ duration: 1.5 });
    const promise = extractFramesWithTimestamps(aFile(), 30, 1);
    await loaded();

    const frames = await promise;

    // Pinned. The `frameCount === 1` branch — which centres the sample rather
    // than sweeping end to end — is unreachable by duration alone for the
    // reason above. `maxFrames: 1` is the only way in, and nothing in the app
    // passes it, so this path is effectively dead code in production.
    expect(frames).toHaveLength(1);
    expect(frames[0].timestampSeconds).toBeCloseTo(0.8, 1);
  });

  it("caps the number of frames however long the video is", async () => {
    setup({ duration: 600 });
    const promise = extractFramesWithTimestamps(aFile(), 1, 20);
    await loaded();

    // Every frame becomes a base64 JPEG in a request body; without the cap a
    // ten-minute upload builds a payload no gateway will accept.
    expect(await promise).toHaveLength(20);
  });

  it("rounds timestamps to a tenth of a second", async () => {
    setup({ duration: 7 });
    const promise = extractFramesWithTimestamps(aFile(), 3, 20);
    await loaded();

    const frames = await promise;

    // The timestamps are shown to an admin alongside the extracted text, so
    // full float precision is noise.
    for (const frame of frames) {
      expect(frame.timestampSeconds).toBe(Math.round(frame.timestampSeconds * 10) / 10);
    }
  });

  it("returns them in order", async () => {
    setup({ duration: 20 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20);
    await loaded();

    const times = (await promise).map((f) => f.timestampSeconds);

    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("scaling the frames", () => {
  it("fits a large frame inside the maximum dimension", async () => {
    setup({ duration: 12, videoWidth: 1920, videoHeight: 1080 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20, 768);
    await loaded();
    await promise;

    // Aspect ratio preserved: 1920x1080 at 768 wide is 432 tall.
    expect(canvasSize).toEqual({ width: 768, height: 432 });
  });

  it("fits a portrait frame by its height", async () => {
    setup({ duration: 12, videoWidth: 1080, videoHeight: 1920 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20, 768);
    await loaded();
    await promise;

    // Most memes are portrait; scaling by width would leave them oversized.
    expect(canvasSize).toEqual({ width: 432, height: 768 });
  });

  it("never upscales a small frame", async () => {
    setup({ duration: 12, videoWidth: 320, videoHeight: 240 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20, 768);
    await loaded();
    await promise;

    // Upscaling adds bytes and no legibility.
    expect(canvasSize).toEqual({ width: 320, height: 240 });
  });
});

describe("the source and its lifetime", () => {
  it("makes an object URL for a file and revokes it when done", async () => {
    setup({ duration: 12 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20);
    await loaded();
    await promise;

    // An un-revoked blob URL pins the whole video in memory until the tab
    // closes, and admins upload several in a sitting.
    expect(created).toHaveLength(1);
    expect(revoked).toEqual(created);
  });

  it("revokes the URL when the video will not load", async () => {
    setup({ duration: 12 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20);
    await Promise.resolve();
    video.onerror?.();

    await expect(promise).rejects.toThrow(/Failed to load video/);
    expect(revoked).toEqual(created);
  });

  it("revokes the URL when the duration is unreadable", async () => {
    setup({ duration: Number.POSITIVE_INFINITY });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20);
    await loaded();

    // A stream, or a container the browser cannot measure — there is no way to
    // pick timestamps, so it fails rather than sampling blindly.
    await expect(promise).rejects.toThrow(/Could not determine video duration/);
    expect(revoked).toEqual(created);
  });

  it("rejects a zero-length video", async () => {
    setup({ duration: 0 });
    const promise = extractFramesWithTimestamps(aFile(), 4, 20);
    await loaded();

    await expect(promise).rejects.toThrow(/Could not determine video duration/);
  });

  it("leaves a URL it was handed alone", async () => {
    setup({ duration: 12 });
    const promise = extractFramesWithTimestamps("blob:caller-owned", 4, 20);
    await loaded();
    await promise;

    // The caller owns a URL it created; revoking it here would break their
    // player.
    expect(created).toHaveLength(0);
    expect(revoked).toHaveLength(0);
  });
});
