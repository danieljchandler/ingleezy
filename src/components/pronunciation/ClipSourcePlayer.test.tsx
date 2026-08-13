import { act, render as rtlRender } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShadowClip } from "@/hooks/useShadowQueue";
import {
  ClipSourcePlayer,
  type ClipSourcePlayerHandle,
  type ExternalYouTubeController,
} from "./ClipSourcePlayer";

/**
 * Playing the native-speaker clip a learner is about to imitate.
 *
 * Shadowing only works if the model plays exactly the span being practised and
 * then stops — a clip that runs on into the next sentence has the learner
 * imitating the wrong words, and one that never reports finishing leaves the
 * exercise stuck on "Listening…" with no way forward. So the two things this
 * component owes its caller are: stop at `endSec`, and call `onEnded` exactly
 * once when it does.
 *
 * It plays from two very different sources. A direct audio file is easy. A
 * YouTube clip is not: the iframe API is asynchronous, there is no "play until
 * this timestamp" primitive so the position has to be polled, and a fresh
 * cross-origin iframe has no user engagement, so its first `playVideo()` is
 * often blocked silently. Every branch below exists because of one of those.
 */

const ytApi = vi.hoisted(() => ({ load: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/youtubeIframeApi", () => ({
  loadYouTubeIframeAPI: () => ytApi.load(),
}));

interface PlayerEvents {
  onReady: () => void;
  onError: () => void;
}

/** A stand-in for the YouTube iframe player, driven by the test. */
class FakeYTPlayer {
  static instances: FakeYTPlayer[] = [];
  currentTime = 0;
  state = 2; // paused
  rate = 1;
  seekedTo: number | null = null;
  playCalls = 0;
  pauseCalls = 0;
  destroyed = false;
  private events: PlayerEvents;

  constructor(
    public el: HTMLElement,
    public opts: { videoId: string; events: PlayerEvents; playerVars: Record<string, unknown> },
  ) {
    this.events = opts.events;
    FakeYTPlayer.instances.push(this);
  }

  /** The iframe finished loading. Nothing works before this. */
  becomeReady() {
    this.events.onReady();
  }
  failToLoad() {
    this.events.onError();
  }

  seekTo(s: number) {
    this.seekedTo = s;
    this.currentTime = s;
  }
  playVideo() {
    this.playCalls++;
    this.state = 1;
  }
  pauseVideo() {
    this.pauseCalls++;
    this.state = 2;
  }
  getCurrentTime() {
    return this.currentTime;
  }
  getPlayerState() {
    return this.state;
  }
  setPlaybackRate(r: number) {
    this.rate = r;
  }
  destroy() {
    this.destroyed = true;
  }
}

const AUDIO_CLIP: ShadowClip = {
  id: "clip-1",
  source: "audio",
  audioUrl: "https://audio.test/line.mp3",
  text: "شلونك اليوم",
  startSec: 3,
  endSec: 6,
  dialect: "Gulf",
  locale: "ar-SA",
  sourceTitle: "A market conversation",
};

const YT_CLIP: ShadowClip = {
  ...AUDIO_CLIP,
  id: "clip-2",
  source: "youtube",
  audioUrl: undefined,
  youtubeId: "abc123",
};

let unmount: (() => void) | undefined;
let audioPlay: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  ytApi.load.mockClear().mockImplementation(() => Promise.resolve());
  FakeYTPlayer.instances = [];
  (window as unknown as { YT: unknown }).YT = { Player: FakeYTPlayer };

  // jsdom implements neither, and the component awaits play()'s promise.
  audioPlay = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    audioPlay as unknown as () => Promise<void>,
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  delete (window as unknown as { YT?: unknown }).YT;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

interface Options {
  clip?: ShadowClip;
  externalYouTubeController?: ExternalYouTubeController | null;
}

function mount({ clip = AUDIO_CLIP, externalYouTubeController }: Options = {}) {
  const ref = createRef<ClipSourcePlayerHandle>();
  const onEnded = vi.fn();
  const onError = vi.fn();
  const view = rtlRender(
    <ClipSourcePlayer
      ref={ref}
      clip={clip}
      onEnded={onEnded}
      onError={onError}
      className="clip"
      externalYouTubeController={externalYouTubeController}
    />,
  );
  unmount = view.unmount;
  return { ...view, ref, onEnded, onError };
}

/** The player the mount effect created, once the API promise has settled. */
const settleMount = async () => {
  await act(async () => {});
  return FakeYTPlayer.instances.at(-1)!;
};

/**
 * Runs one poll tick. `play()` only creates its interval after the ready
 * promise resolves, so the microtasks have to be flushed in their own act()
 * before the clock is moved — advancing first ticks a timer that does not yet
 * exist and the promise never settles.
 */
const tick = async (ms = 100) => {
  await act(async () => {});
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

const audioEl = (container: HTMLElement) => container.querySelector("audio")!;

describe("playing an audio file", () => {
  it("preloads the clip so Listen is instant", () => {
    const { container } = mount();

    // The learner taps Listen and expects sound. Fetching on tap puts a network
    // round trip in the middle of a timed exercise.
    expect(audioEl(container)).toHaveAttribute("src", "https://audio.test/line.mp3");
    expect(audioEl(container)).toHaveAttribute("preload", "auto");
  });

  it("is ready as soon as it is mounted", () => {
    const { ref } = mount();

    expect(ref.current!.isReady()).toBe(true);
  });

  it("starts at the clip's beginning, at the asked-for speed", async () => {
    const { ref, container } = mount();

    await act(async () => {
      await ref.current!.play(0.75);
    });

    // Slowing down is the point of the exercise, and starting from zero would
    // play the whole file rather than the line being practised.
    expect(audioEl(container).currentTime).toBe(3);
    expect(audioEl(container).playbackRate).toBe(0.75);
    expect(audioPlay).toHaveBeenCalled();
  });

  it("plays at normal speed by default", async () => {
    const { ref, container } = mount();

    await act(async () => {
      await ref.current!.play();
    });

    expect(audioEl(container).playbackRate).toBe(1);
  });

  it("reports that playback started", async () => {
    const { ref } = mount();

    let started: boolean | undefined;
    await act(async () => {
      started = await ref.current!.play();
    });

    expect(started).toBe(true);
  });

  it("stops at the clip's end and says so", async () => {
    const { ref, container, onEnded } = mount();
    await act(async () => {
      await ref.current!.play();
    });

    const audio = audioEl(container);
    audio.currentTime = 6;
    act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
    });

    // Running on into the next sentence has the learner shadowing words that
    // are not the ones being scored.
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("keeps playing until the end is actually reached", async () => {
    const { ref, container, onEnded } = mount();
    await act(async () => {
      await ref.current!.play();
    });

    const audio = audioEl(container);
    audio.currentTime = 4.5;
    act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
    });

    expect(onEnded).not.toHaveBeenCalled();
  });

  it("finishes when the file runs out before the clip's end", async () => {
    const { ref, container, onEnded } = mount();
    await act(async () => {
      await ref.current!.play();
    });

    act(() => {
      audioEl(container).dispatchEvent(new Event("ended"));
    });

    // A clip whose endSec overruns the file's duration never crosses its end on
    // timeupdate, so without this the exercise waits forever for a moment that
    // cannot arrive.
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("says the clip finished only once", async () => {
    const { ref, container, onEnded } = mount();
    await act(async () => {
      await ref.current!.play();
    });

    const audio = audioEl(container);
    audio.currentTime = 6;
    act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
      audio.dispatchEvent(new Event("ended"));
    });

    // Both safety nets can fire on the same clip. Advancing the exercise twice
    // would skip a line.
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("stops listening for the end once the clip has finished", async () => {
    const { ref, container, onEnded } = mount();
    await act(async () => {
      await ref.current!.play();
    });
    const audio = audioEl(container);
    audio.currentTime = 6;
    act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
    });
    onEnded.mockClear();

    await act(async () => {
      await ref.current!.play();
    });
    audio.currentTime = 6;
    act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
    });

    // Replaying the same clip must not accumulate a listener per attempt, or
    // the fifth listen fires onEnded five times.
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("reports a refused playback rather than hanging", async () => {
    audioPlay.mockRejectedValue(new Error("NotAllowedError: play() failed"));
    const { ref, onError, onEnded } = mount();

    let started: boolean | undefined;
    await act(async () => {
      started = await ref.current!.play();
    });

    // Autoplay policies block this on a page the learner has not interacted
    // with. Silence with no message reads as the feature being broken.
    expect(started).toBe(false);
    expect(onError).toHaveBeenCalledWith("NotAllowedError: play() failed");
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("does not leave the end-listeners behind after a refused play", async () => {
    audioPlay.mockRejectedValue(new Error("blocked"));
    const { ref, container, onEnded } = mount();
    await act(async () => {
      await ref.current!.play();
    });

    const audio = audioEl(container);
    audio.currentTime = 6;
    act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
    });

    // A clip that never started must not be able to report that it finished.
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("can be stopped part way", async () => {
    const { ref } = mount();
    await act(async () => {
      await ref.current!.play();
    });

    act(() => {
      ref.current!.pause();
    });

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("does not treat a manual stop as the clip finishing", async () => {
    const { ref, onEnded } = mount();
    await act(async () => {
      await ref.current!.play();
    });

    act(() => {
      ref.current!.pause();
    });

    // Pausing to think is not the same as having heard the line; advancing here
    // would push the learner into recording before they were ready.
    expect(onEnded).not.toHaveBeenCalled();
  });
});

describe("driving a YouTube player that already exists", () => {
  const controller = (): ExternalYouTubeController & {
    ended?: () => void;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  } => {
    const c = {
      ended: undefined as (() => void) | undefined,
      play: vi.fn(async (_s: number, _e: number, _r: number, onEnded: () => void) => {
        c.ended = onEnded;
        return true;
      }),
      pause: vi.fn(),
    };
    return c;
  };

  it("renders nothing of its own", () => {
    const external = controller();
    const { container } = mount({ clip: YT_CLIP, externalYouTubeController: external });

    // The whole point is to reuse the page's existing player. A second iframe
    // would be the fresh, engagement-less one this exists to avoid.
    expect(container.innerHTML).toBe("");
    expect(FakeYTPlayer.instances).toHaveLength(0);
  });

  it("is ready immediately", () => {
    const external = controller();
    const { ref } = mount({ clip: YT_CLIP, externalYouTubeController: external });

    // The borrowed player has already played, which is exactly why it is
    // borrowed.
    expect(ref.current!.isReady()).toBe(true);
  });

  it("hands the span and the speed to the existing player", async () => {
    const external = controller();
    const { ref } = mount({ clip: YT_CLIP, externalYouTubeController: external });

    await act(async () => {
      await ref.current!.play(0.5);
    });

    expect(external.play).toHaveBeenCalledWith(3, 6, 0.5, expect.any(Function));
  });

  it("passes the finish back up", async () => {
    const external = controller();
    const { ref, onEnded } = mount({ clip: YT_CLIP, externalYouTubeController: external });
    await act(async () => {
      await ref.current!.play();
    });

    act(() => {
      external.ended!();
      external.ended!();
    });

    // Guarded on this side too: the external player has its own polling and can
    // report the end more than once.
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("stops the existing player rather than its own", () => {
    const external = controller();
    const { ref } = mount({ clip: YT_CLIP, externalYouTubeController: external });

    act(() => {
      ref.current!.pause();
    });

    expect(external.pause).toHaveBeenCalled();
  });
});

describe("playing a YouTube clip in its own iframe", () => {
  it("builds a player for the clip's video", async () => {
    mount({ clip: YT_CLIP });

    const player = await settleMount();
    expect(player.opts.videoId).toBe("abc123");
    // Chrome-less: the learner is shadowing, not browsing. Keyboard control and
    // related videos would both take them out of the exercise.
    expect(player.opts.playerVars).toMatchObject({ controls: 0, disablekb: 1, rel: 0 });
  });

  it("is not ready until the iframe says so", async () => {
    const { ref } = mount({ clip: YT_CLIP });
    const player = await settleMount();

    expect(ref.current!.isReady()).toBe(false);
    await act(async () => {
      player.becomeReady();
    });
    expect(ref.current!.isReady()).toBe(true);
  });

  it("seeks to the clip and plays it at the asked-for speed", async () => {
    const { ref } = mount({ clip: YT_CLIP });
    const player = await settleMount();
    await act(async () => {
      player.becomeReady();
    });

    let started!: Promise<boolean>;
    await act(async () => {
      started = ref.current!.play(0.75);
    });
    await tick();
    await act(async () => {
      expect(await started).toBe(true);
    });

    expect(player.seekedTo).toBe(3);
    expect(player.rate).toBe(0.75);
    expect(player.playCalls).toBe(1);
  });

  it("waits for a player that is still loading instead of refusing", async () => {
    const { ref, onError } = mount({ clip: YT_CLIP });
    const player = await settleMount();

    // The learner taps Listen the moment the card appears — routinely before the
    // iframe is up. Refusing here would make the first tap of every clip fail.
    let started!: Promise<boolean>;
    await act(async () => {
      started = ref.current!.play();
    });
    await act(async () => {
      player.becomeReady();
    });
    await tick();
    await act(async () => {
      expect(await started).toBe(true);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("gives up on a player that never loads", async () => {
    const { ref, onError } = mount({ clip: YT_CLIP });
    await settleMount();

    let started!: Promise<boolean>;
    await act(async () => {
      started = ref.current!.play();
    });
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    await act(async () => {
      expect(await started).toBe(false);
    });

    // Eight seconds, then an actionable message. Waiting forever is the failure
    // this exists to prevent.
    expect(onError).toHaveBeenCalledWith("Video is taking too long to load — try again.");
  });

  it("says when the video itself will not load", async () => {
    const { onError } = mount({ clip: YT_CLIP });
    const player = await settleMount();

    await act(async () => {
      player.failToLoad();
    });

    // Private, deleted or region-blocked videos are a real and recurring state
    // for curated clips.
    expect(onError).toHaveBeenCalledWith("Video failed to load");
  });

  it("stops at the clip's end and says so", async () => {
    const { ref, onEnded } = mount({ clip: YT_CLIP });
    const player = await settleMount();
    await act(async () => {
      player.becomeReady();
    });
    await act(async () => {
      void ref.current!.play();
    });
    await tick();

    player.currentTime = 6;
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // There is no "play until" in the iframe API, so the position is polled and
    // the stop is ours to make.
    expect(player.pauseCalls).toBe(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("stops polling once the clip is done", async () => {
    const { ref, onEnded } = mount({ clip: YT_CLIP });
    const player = await settleMount();
    await act(async () => {
      player.becomeReady();
    });
    await act(async () => {
      void ref.current!.play();
    });
    await tick();
    player.currentTime = 6;
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // A poll left running keeps pausing a player the learner may since have
    // started again for another clip.
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(player.pauseCalls).toBe(1);
  });

  it("treats a position that is advancing as playing", async () => {
    const { ref } = mount({ clip: YT_CLIP });
    const player = await settleMount();
    await act(async () => {
      player.becomeReady();
    });

    // Some states report as buffering while the clip is audibly running, so the
    // clock moving forward counts as confirmation on its own.
    player.getPlayerState = () => 3; // buffering
    let started!: Promise<boolean>;
    await act(async () => {
      started = ref.current!.play();
    });
    await tick();
    player.currentTime = 3.5;
    await tick();
    await act(async () => {
      expect(await started).toBe(true);
    });
  });

  it("gives up when the browser silently blocked playback", async () => {
    const { ref, onError } = mount({ clip: YT_CLIP });
    const player = await settleMount();
    await act(async () => {
      player.becomeReady();
    });

    // A fresh cross-origin iframe has no user engagement, so playVideo() can be
    // refused with no error and no state change at all. Five seconds of a clock
    // that never moves is the only signal there is.
    player.getPlayerState = () => 2;
    player.playVideo = () => {};
    let started!: Promise<boolean>;
    await act(async () => {
      started = ref.current!.play();
    });
    await tick(5200);
    await act(async () => {
      expect(await started).toBe(false);
    });
    expect(onError).toHaveBeenCalledWith("Couldn't play the clip — tap Listen to try again.");
  });

  it("can be stopped part way without reporting a finish", async () => {
    const { ref, onEnded } = mount({ clip: YT_CLIP });
    const player = await settleMount();
    await act(async () => {
      player.becomeReady();
    });
    await act(async () => {
      void ref.current!.play();
    });
    await tick();

    act(() => {
      ref.current!.pause();
    });
    player.currentTime = 6;
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(player.pauseCalls).toBeGreaterThan(0);
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("tears the player down when the card goes away", async () => {
    mount({ clip: YT_CLIP });
    const player = await settleMount();
    await act(async () => {
      player.becomeReady();
    });

    act(() => {
      unmount!();
      unmount = undefined;
    });

    // An orphaned iframe keeps playing audio over whatever the learner does
    // next.
    expect(player.destroyed).toBe(true);
  });
});
