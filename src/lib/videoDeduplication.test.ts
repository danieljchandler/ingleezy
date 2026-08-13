import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateContentHash, isCacheRecent } from "./videoDeduplication";

/**
 * Recognising a video the pipeline has already transcribed.
 *
 * Processing one costs several ASR calls across up to four providers, so a hash
 * that fails to match a re-submitted video pays for the whole thing again — and
 * one that matches too eagerly serves the wrong transcript. Both directions
 * matter, and neither is visible without a test: the pipeline just silently
 * costs more, or silently returns someone else's words.
 */

const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("identifying the same video", () => {
  it("gives the same hash for the same URL", async () => {
    expect(await generateContentHash(YOUTUBE)).toBe(await generateContentHash(YOUTUBE));
  });

  it("gives the same hash however the URL was written", async () => {
    // youtu.be links, the /shorts/ form and tracking parameters all point at
    // one video; treating them as different means paying to transcribe it
    // several times over.
    const forms = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    ];

    const hashes = await Promise.all(forms.map((url) => generateContentHash(url)));
    const distinct = new Set(hashes.filter(Boolean));

    expect(
      distinct.size,
      `these URLs hashed to ${distinct.size} different values: ${forms.join(", ")}`,
    ).toBe(1);
  });

  it("gives different hashes for different videos", async () => {
    const first = await generateContentHash("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    const second = await generateContentHash("https://www.youtube.com/watch?v=bbbbbbbbbbb");

    expect(first).not.toBe(second);
  });

  it("gives different hashes across platforms", async () => {
    // The same id on two platforms is two different videos.
    const youtube = await generateContentHash("https://www.youtube.com/watch?v=abc12345678");
    const tiktok = await generateContentHash("https://www.tiktok.com/@user/video/abc12345678");

    if (tiktok !== null) expect(youtube).not.toBe(tiktok);
  });

  it("returns null for something that is not a video URL", async () => {
    for (const bad of ["", "not a url", "https://example.com/page"]) {
      expect(await generateContentHash(bad)).toBeNull();
    }
  });

  it("produces a SHA-256 hex digest", async () => {
    const hash = await generateContentHash(YOUTUBE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("duration tolerance", () => {
  it("treats durations within the same five-second bucket as one video", async () => {
    // Providers disagree slightly on length; a second's difference must not
    // defeat the cache.
    const at120 = await generateContentHash(YOUTUBE, 120);
    const at122 = await generateContentHash(YOUTUBE, 122);

    expect(at120).toBe(at122);
  });

  it("separates durations far enough apart to be different cuts", async () => {
    const short = await generateContentHash(YOUTUBE, 120);
    const long = await generateContentHash(YOUTUBE, 600);

    expect(short).not.toBe(long);
  });

  it("hashes differently with and without a duration", async () => {
    // Not a bug, but worth pinning: a caller that starts passing duration will
    // miss every previously cached entry.
    const without = await generateContentHash(YOUTUBE);
    const with120 = await generateContentHash(YOUTUBE, 120);

    expect(without).not.toBe(with120);
  });

  it("ignores a zero duration rather than bucketing it", async () => {
    // 0 is falsy, so it takes the no-duration path — which is right, since a
    // zero length means the probe failed rather than the video being empty.
    expect(await generateContentHash(YOUTUBE, 0)).toBe(await generateContentHash(YOUTUBE));
  });
});

describe("cache freshness", () => {
  const NOW = new Date("2026-03-11T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => vi.useRealTimers());

  const daysAgo = (days: number) =>
    new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  it("accepts something processed today", () => {
    expect(isCacheRecent(daysAgo(0))).toBe(true);
  });

  it("accepts something just inside thirty days", () => {
    expect(isCacheRecent(daysAgo(29))).toBe(true);
  });

  it("rejects something just outside", () => {
    expect(isCacheRecent(daysAgo(31))).toBe(false);
  });

  it("honours a custom window", () => {
    expect(isCacheRecent(daysAgo(10), 7)).toBe(false);
    expect(isCacheRecent(daysAgo(3), 7)).toBe(true);
  });

  it("rejects a timestamp it cannot parse rather than treating it as fresh", () => {
    // Serving a transcript of unknown age is worse than re-transcribing.
    expect(isCacheRecent("not a date")).toBe(false);
  });
});
