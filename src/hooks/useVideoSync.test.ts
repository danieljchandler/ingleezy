import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useVideoSync } from "./useVideoSync";
import type { Segment } from "@/types/transcript";

/**
 * Keeping a transcript and its video in step.
 *
 * This is the heart of the transcribe/review screen: tap a line to hear exactly
 * that line, and watch the current word light up as it is spoken. For a learner
 * working through native-speed Arabic, replaying one clause on demand is the
 * difference between "I can't follow this" and a usable exercise — the whole
 * point is to hear a short span as many times as it takes.
 *
 * Which is why playback has to *stop* at the segment's end. A tap that plays to
 * the end of the video means the learner has to find the pause button, then
 * find their place again.
 */

const aWord = (word: string, start: number, end: number) => ({
  word,
  start,
  end,
  confidence: 0.9,
});

const aSegment = (over: Partial<Segment> = {}): Segment => ({
  id: "seg-1",
  video_id: "vid-1",
  start: 0,
  end: 2,
  text: "شخبارك",
  translation: "how are you",
  confidence: 0.9,
  words: [aWord("شخبارك", 0, 2)],
  ...over,
});

const TWO_SEGMENTS: Segment[] = [
  aSegment({
    id: "seg-1",
    start: 0,
    end: 2,
    words: [aWord("شلونك", 0, 1), aWord("اليوم", 1, 2)],
  }),
  aSegment({ id: "seg-2", start: 5, end: 7, words: [aWord("زين", 5, 7)] }),
];

/** A <video> with the playback surface the hook drives. */
function aVideo(play: () => Promise<void> = () => Promise.resolve()) {
  const element = document.createElement("video");
  element.play = vi.fn(play) as unknown as HTMLVideoElement["play"];
  element.pause = vi.fn();
  return element;
}

/**
 * Mount with the video already attached.
 *
 * The ref is assigned in the render body because React attaches a real ref
 * during commit, before effects — and the highlight effect only ever runs once
 * (see the test that pins that).
 */
function render(segments: Segment[], video = aVideo()) {
  const ref = { current: video as HTMLVideoElement | null };
  const harness = renderHook(({ list }: { list: Segment[] }) => useVideoSync(list, ref), {
    initialProps: { list: segments },
  });
  return { ...harness, video, ref };
}

const playTo = (video: HTMLVideoElement, time: number) => {
  act(() => {
    video.currentTime = time;
    video.dispatchEvent(new Event("timeupdate"));
  });
};

describe("playing one segment", () => {
  it("seeks to its start and plays", () => {
    const { result, video } = render(TWO_SEGMENTS);

    act(() => {
      result.current.seekToSegment("seg-2");
    });

    expect(video.currentTime).toBe(5);
    expect(video.play).toHaveBeenCalled();
  });

  it("stops at the segment's end", () => {
    const { result, video } = render(TWO_SEGMENTS);
    act(() => {
      result.current.seekToSegment("seg-1");
    });

    playTo(video, 2.1);

    // The reason the feature is usable: a tap replays one clause, and the
    // learner can tap again immediately rather than hunting for pause.
    expect(video.pause).toHaveBeenCalled();
  });

  it("keeps playing until it gets there", () => {
    const { result, video } = render(TWO_SEGMENTS);
    act(() => {
      result.current.seekToSegment("seg-1");
    });

    playTo(video, 1.5);

    expect(video.pause).not.toHaveBeenCalled();
  });

  it("stops watching once it has stopped", () => {
    const { result, video } = render(TWO_SEGMENTS);
    act(() => {
      result.current.seekToSegment("seg-1");
    });
    playTo(video, 2.1);
    (video.pause as ReturnType<typeof vi.fn>).mockClear();

    // Playing on past the end — the learner pressed play themselves.
    playTo(video, 3);

    // A listener that stayed attached would pause the video every quarter
    // second for the rest of the session, which reads as playback being broken.
    expect(video.pause).not.toHaveBeenCalled();
  });

  it("replaces the stop point when another segment is tapped", () => {
    const { result, video } = render(TWO_SEGMENTS);
    act(() => {
      result.current.seekToSegment("seg-1");
    });

    act(() => {
      result.current.seekToSegment("seg-2");
    });
    playTo(video, 2.1);

    // Tapping down a transcript is the normal interaction. The first segment's
    // stop point must not survive to cut the second one off after 2 seconds.
    expect(video.pause).not.toHaveBeenCalled();
    playTo(video, 7.1);
    expect(video.pause).toHaveBeenCalled();
  });

  it("ignores a tap on a segment that is not there", () => {
    const { result, video } = render(TWO_SEGMENTS);

    act(() => {
      result.current.seekToSegment("seg-nope");
    });

    // Segments are edited and merged on this screen, so a stale id from a list
    // rendered a moment ago is an ordinary occurrence.
    expect(video.play).not.toHaveBeenCalled();
  });

  it("uses the latest segments after an edit", () => {
    const moved = [aSegment({ id: "seg-1", start: 9, end: 11 })];
    const { result, video, rerender } = render(TWO_SEGMENTS);

    rerender({ list: moved });
    act(() => {
      result.current.seekToSegment("seg-1");
    });

    // Timestamps are dragged on this screen; seeking to where a segment used to
    // be would play the wrong audio for the line the learner tapped.
    expect(video.currentTime).toBe(9);
  });

  it("cleans up when playback is refused", async () => {
    const video = aVideo(() => Promise.reject(new Error("NotAllowedError")));
    const { result } = render(TWO_SEGMENTS, video);

    await act(async () => {
      result.current.seekToSegment("seg-1");
    });
    playTo(video, 2.1);

    // Nothing is playing, so pausing at the "end" of a segment that never
    // started would be a stray call on a video the learner may have started
    // themselves.
    expect(video.pause).not.toHaveBeenCalled();
  });

  it("does nothing when there is no video yet", () => {
    const ref = { current: null as HTMLVideoElement | null };
    const { result } = renderHook(() => useVideoSync(TWO_SEGMENTS, ref));

    expect(() =>
      act(() => {
        result.current.seekToSegment("seg-1");
      }),
    ).not.toThrow();
  });
});

describe("highlighting as it plays", () => {
  it("marks the segment being spoken", () => {
    const { result, video } = render(TWO_SEGMENTS);

    playTo(video, 5.5);

    expect(result.current.activeSegmentId).toBe("seg-2");
  });

  it("marks the word being spoken", () => {
    const { result, video } = render(TWO_SEGMENTS);

    playTo(video, 1.5);

    // Word-level highlighting is what lets a learner catch which word they
    // missed, rather than only which sentence.
    expect(result.current.activeSegmentId).toBe("seg-1");
    expect(result.current.activeWordIndex).toBe(1);
  });

  it("marks nothing in the gaps between segments", () => {
    const { result, video } = render(TWO_SEGMENTS);
    playTo(video, 1);

    playTo(video, 3.5);

    // Silence between clauses is real; highlighting the previous line through
    // it would say someone is still speaking.
    expect(result.current.activeSegmentId).toBeNull();
    expect(result.current.activeWordIndex).toBe(-1);
  });

  it("marks the segment but no word when the gap is inside it", () => {
    const { result, video } = render([
      aSegment({ id: "seg-1", start: 0, end: 4, words: [aWord("زين", 0, 1)] }),
    ]);

    playTo(video, 3);

    // A pause mid-sentence still belongs to the sentence, and the transcript
    // line should stay lit while the word highlight moves off.
    expect(result.current.activeSegmentId).toBe("seg-1");
    expect(result.current.activeWordIndex).toBe(-1);
  });

  it("follows the latest segments after an edit", () => {
    const { result, video, rerender } = render(TWO_SEGMENTS);

    rerender({ list: [aSegment({ id: "renamed", start: 5, end: 7 })] });
    playTo(video, 5.5);

    expect(result.current.activeSegmentId).toBe("renamed");
  });

  it("stops listening once unmounted", () => {
    const { result, video, unmount } = render(TWO_SEGMENTS);
    playTo(video, 5.5);
    unmount();

    playTo(video, 1);

    // The last value stands rather than updating a dead tree.
    expect(result.current.activeSegmentId).toBe("seg-2");
  });

  it("never highlights anything when the video arrives late", () => {
    const ref = { current: null as HTMLVideoElement | null };
    const { result } = renderHook(() => useVideoSync(TWO_SEGMENTS, ref));
    const video = aVideo();
    ref.current = video;

    playTo(video, 5.5);

    // Pinned. The highlight effect depends only on `videoRef` — a ref object
    // whose identity never changes — so it runs once at mount and never again.
    // When the media element renders after the URL resolves, which is what the
    // transcribe screen does, the listener is attached to nothing and word
    // highlighting is silently dead for that session. `seekToSegment` works
    // because it reads the ref at click time; its own comment names this, and
    // the highlight half was never given the same treatment.
    expect(result.current.activeSegmentId).toBeNull();
  });
});
