import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioPlayer } from "./useAudioPlayer";

/**
 * One sound at a time, and nothing left running behind you.
 *
 * Almost every screen in this app has a speaker button — a word, a sentence, a
 * jingle, a set phrase. Tapping down a vocabulary list is the normal way to use
 * it, and without a single owned element that means five clips playing over each
 * other, which is not merely untidy: overlapping Arabic is unintelligible, and
 * the learner cannot tell which word they are hearing.
 *
 * The other half is teardown. Navigating away mid-clip must stop it, or audio
 * keeps playing over the next screen with no visible control to stop it.
 */

interface FakeAudio {
  src: string;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

const created: FakeAudio[] = [];
let nextPlay: () => Promise<void> = () => Promise.resolve();

const originalAudio = globalThis.Audio;

beforeEach(() => {
  created.length = 0;
  nextPlay = () => Promise.resolve();
  globalThis.Audio = class {
    src: string;
    play = vi.fn(() => nextPlay());
    pause = vi.fn();
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(src: string) {
      this.src = src;
      created.push(this as unknown as FakeAudio);
    }
  } as unknown as typeof Audio;
});

afterEach(() => {
  globalThis.Audio = originalAudio;
});

const last = () => created[created.length - 1];

describe("playing a clip", () => {
  it("plays the url it was given", () => {
    const { result } = renderHook(() => useAudioPlayer());

    act(() => {
      result.current.play("https://cdn.test/word.mp3");
    });

    expect(last().src).toBe("https://cdn.test/word.mp3");
    expect(last().play).toHaveBeenCalled();
  });

  it("reports that it is playing straight away", () => {
    const { result } = renderHook(() => useAudioPlayer());

    act(() => {
      result.current.play("https://cdn.test/word.mp3");
    });

    // Set before the play() promise settles, so the speaker icon changes under
    // the finger rather than after the audio has actually started.
    expect(result.current.isPlaying).toBe(true);
  });

  it("is idle before anything has been played", () => {
    const { result } = renderHook(() => useAudioPlayer());

    expect(result.current.isPlaying).toBe(false);
  });

  it("goes idle when the clip finishes", () => {
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.play("https://cdn.test/word.mp3");
    });

    act(() => {
      last().onended?.();
    });

    expect(result.current.isPlaying).toBe(false);
  });
});

describe("only one sound at a time", () => {
  it("stops the previous clip before starting the next", () => {
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.play("https://cdn.test/first.mp3");
    });
    const first = last();

    act(() => {
      result.current.play("https://cdn.test/second.mp3");
    });

    // Tapping down a word list is the normal interaction. Two Arabic words
    // spoken over each other are worse than one word missed.
    expect(first.pause).toHaveBeenCalled();
    expect(last().src).toBe("https://cdn.test/second.mp3");
  });

  it("restarts the same url rather than ignoring the tap", () => {
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.play("https://cdn.test/word.mp3");
    });

    act(() => {
      result.current.play("https://cdn.test/word.mp3");
    });

    // Tapping a word a second time means "say it again" — the single most
    // common thing a learner does with these buttons.
    expect(created).toHaveLength(2);
    expect(result.current.isPlaying).toBe(true);
  });

  it("ignores the old clip's handlers once it has been replaced", () => {
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.play("https://cdn.test/first.mp3");
    });
    const first = last();
    act(() => {
      result.current.play("https://cdn.test/second.mp3");
    });

    act(() => {
      first.onended?.();
    });

    // The handlers are detached on cleanup, so a pause-triggered `ended` from
    // the clip that was interrupted cannot report the *new* clip as finished.
    expect(result.current.isPlaying).toBe(true);
  });
});

describe("stopping", () => {
  it("pauses and goes idle", () => {
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.play("https://cdn.test/word.mp3");
    });
    const audio = last();

    act(() => {
      result.current.stop();
    });

    expect(audio.pause).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
  });

  it("is harmless when nothing is playing", () => {
    const { result } = renderHook(() => useAudioPlayer());

    expect(() =>
      act(() => {
        result.current.stop();
      }),
    ).not.toThrow();
  });

  it("stops the clip when the screen goes away", () => {
    const { result, unmount } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.play("https://cdn.test/word.mp3");
    });
    const audio = last();

    unmount();

    // Navigating away mid-word would otherwise leave Arabic playing over the
    // next screen with no button anywhere to stop it.
    expect(audio.pause).toHaveBeenCalled();
  });
});

describe("when the clip will not play", () => {
  it("goes idle when playback is refused", async () => {
    nextPlay = () => Promise.reject(new Error("NotAllowedError"));
    const { result } = renderHook(() => useAudioPlayer());

    await act(async () => {
      result.current.play("https://cdn.test/word.mp3");
    });

    // A speaker icon stuck in its "playing" state on a clip that never started
    // reads as the app having hung.
    expect(result.current.isPlaying).toBe(false);
  });

  it("goes idle when the file cannot be loaded", () => {
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.play("https://cdn.test/missing.mp3");
    });

    act(() => {
      last().onerror?.();
    });

    // Generated audio is uploaded asynchronously, so a row can carry a URL
    // whose object is not there yet.
    expect(result.current.isPlaying).toBe(false);
  });
});
