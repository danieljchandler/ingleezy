import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { LineShadowPanel } from "./LineShadowPanel";
import type { ExternalYouTubeController } from "./ClipSourcePlayer";
import type { ShadowScoreResult } from "@/hooks/useShadowScore";
import type { ShadowClip } from "@/hooks/useShadowQueue";

/**
 * Shadowing one line without leaving the video.
 *
 * The full shadowing session takes a learner out of whatever they were doing
 * and hands them a queue. This is the other half of the same idea: they are
 * already watching a Discovery clip, one line was interesting, and repeating it
 * should cost a tap and give the line back when they are done.
 *
 * What makes it different from a generic pronunciation check is what it scores
 * against. The reference is the clip itself — the words the native actually
 * said, and where clip audio is available, how it sounded — rather than a model
 * reading the text. Matching a synthetic voice is not the goal.
 */

const player = vi.hoisted(() => ({
  play: vi.fn(async (_rate?: number) => true),
  pause: vi.fn(),
  onEnded: null as null | (() => void),
  externalController: undefined as ExternalYouTubeController | null | undefined,
  clipSource: "" as string,
}));

const recorder = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  level: 0,
  error: null as string | null,
  permissionDenied: false,
  isRecording: false,
}));

const scorer = vi.hoisted(() => ({
  score: vi.fn(),
  result: null as ShadowScoreResult | null,
  isLoading: false,
  error: null as string | null,
  reset: vi.fn(),
}));

vi.mock("./ClipSourcePlayer", () => ({
  ClipSourcePlayer: forwardRef(
    (
      props: {
        clip: ShadowClip;
        onEnded: () => void;
        externalYouTubeController?: ExternalYouTubeController | null;
      },
      ref: React.Ref<unknown>,
    ) => {
      player.onEnded = props.onEnded;
      player.externalController = props.externalYouTubeController;
      player.clipSource = props.clip.source;
      useImperativeHandle(ref, () => ({
        play: player.play,
        pause: player.pause,
        isReady: () => true,
      }));
      return <div data-testid="clip-source" />;
    },
  ),
}));

vi.mock("@/hooks/useShadowRecorder", () => ({
  useShadowRecorder: () => recorder,
}));

vi.mock("@/hooks/useShadowScore", () => ({
  useShadowScore: () => scorer,
}));

const A_CLIP: ShadowClip = {
  id: "clip-1",
  source: "audio",
  audioUrl: "https://audio.test/line.mp3",
  text: "وين رايح؟",
  translation: "Where are you going?",
  startSec: 10,
  endSec: 12,
  dialect: "Gulf",
  locale: "ar-KW",
  sourceTitle: "Kuwaiti vlog",
};

const aScore = (over: Partial<ShadowScoreResult> = {}): ShadowScoreResult => ({
  overall: 82,
  transcriptSimilarity: 88,
  acousticSimilarity: 74,
  recognizedText: "وين رايح",
  wordDiffs: [],
  tips: ["The ر in رايح is tapped, not rolled."],
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  player.play.mockReset().mockResolvedValue(true);
  player.pause.mockReset();
  player.externalController = undefined;
  recorder.start.mockReset();
  recorder.stop.mockReset();
  recorder.level = 0;
  recorder.error = null;
  recorder.permissionDenied = false;
  scorer.score.mockReset();
  scorer.result = null;
  scorer.isLoading = false;
  scorer.error = null;
  scorer.reset.mockReset().mockImplementation(() => {
    scorer.result = null;
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  clip?: ShadowClip;
  nativeClipWav?: Blob | null;
  externalYouTubeController?: ExternalYouTubeController | null;
}

function render({ clip = A_CLIP, nativeClipWav, externalYouTubeController }: Options = {}) {
  const onClose = vi.fn();
  const harness = renderWithProviders(
    <LineShadowPanel
      clip={clip}
      nativeClipWav={nativeClipWav}
      externalYouTubeController={externalYouTubeController}
      onClose={onClose}
    />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onClose };
}

const listenThrough = async () => {
  fireEvent.click(screen.getByRole("button", { name: /listen & repeat/i }));
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    player.onEnded?.();
  });
};

const finishRecording = async (blob: Blob | null, reason?: string) => {
  const options = recorder.start.mock.calls.at(-1)?.[0] as {
    onComplete: (blob: Blob | null, reason?: string) => void | Promise<void>;
  };
  await act(async () => {
    await options.onComplete(blob, reason);
  });
};

const aTake = () => new Blob([new Uint8Array(8)], { type: "audio/webm" });

const takeScoring = async (over: Partial<ShadowScoreResult> = {}) => {
  scorer.score.mockImplementation(async () => {
    scorer.result = aScore(over);
    return scorer.result;
  });
  await listenThrough();
  await finishRecording(aTake());
};

describe("opening the panel", () => {
  it("keeps the line to repeat on screen throughout", () => {
    render();

    // It sits under the transcript line it belongs to, and a learner who has
    // just heard the clip still needs to see the words while they say them.
    expect(screen.getByText("وين رايح؟")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("Where are you going?")).toBeInTheDocument();
  });

  it("gives the line back when the learner is done with it", () => {
    const { onClose } = render();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it("shows a video frame for a YouTube clip of its own", () => {
    const { container } = render({ clip: { ...A_CLIP, source: "youtube", youtubeId: "abc" } });

    // A cross-origin iframe will not play unmuted until it is on screen, so a
    // standalone clip has to be visible.
    expect(container.querySelector(".aspect-video")).not.toBeNull();
  });

  it("stays out of sight when it is driving the video already on the page", () => {
    const external: ExternalYouTubeController = { play: vi.fn(async () => true), pause: vi.fn() };
    const { container } = render({
      clip: { ...A_CLIP, source: "youtube", youtubeId: "abc" },
      externalYouTubeController: external,
    });

    // Reusing the player the learner is already watching avoids a second copy
    // of the same video, and avoids the autoplay block a fresh iframe hits.
    expect(container.querySelector(".aspect-video")).toBeNull();
    expect(player.externalController).toBe(external);
  });
});

describe("hearing it and repeating it", () => {
  it("plays at full speed by default", async () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: /listen & repeat/i }));

    await waitFor(() => expect(player.play).toHaveBeenCalledWith(1));
  });

  it("plays slower when the learner asks", async () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: "0.75×" }));
    fireEvent.click(screen.getByRole("button", { name: /listen & repeat/i }));

    // Three-quarter speed is where a learner can still hear the rhythm but has
    // time to place the consonants.
    await waitFor(() => expect(player.play).toHaveBeenCalledWith(0.75));
  });

  it("goes back to waiting when the clip will not start", async () => {
    player.play.mockResolvedValue(false);
    render();

    fireEvent.click(screen.getByRole("button", { name: /listen & repeat/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /listen & repeat/i })).toBeEnabled(),
    );
  });

  it("opens the microphone as soon as the clip stops", async () => {
    render();

    await listenThrough();

    expect(screen.getByText("Repeat now")).toBeInTheDocument();
    // Two seconds of clip plus a breath and a half.
    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ maxDurationMs: 3500, trailingSilenceMs: 600 }),
    );
  });

  it("gives a very short line a floor to speak into", async () => {
    render({ clip: { ...A_CLIP, startSec: 10, endSec: 10.3 } });

    await listenThrough();

    expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({ maxDurationMs: 2300 }));
  });

  it("lets the learner stop early", async () => {
    render();
    await listenThrough();

    fireEvent.click(screen.getByRole("button", { name: /stop recording/i }));

    expect(recorder.stop).toHaveBeenCalledWith("manual");
  });

  it("says it heard nothing rather than scoring silence", async () => {
    render();
    await listenThrough();

    await finishRecording(null, "no-audio");

    expect(screen.getByText("We didn't hear you — try again.")).toBeInTheDocument();
    expect(scorer.score).not.toHaveBeenCalled();
  });

  it("reports a recording that failed some other way", async () => {
    render();
    await listenThrough();

    await finishRecording(null, "error");

    expect(screen.getByText("Recording failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("explains a refused microphone", async () => {
    recorder.permissionDenied = true;
    recorder.error = "Microphone blocked";
    render();

    expect(screen.getByText(/enable mic access/i)).toBeInTheDocument();
  });
});

describe("scoring against the clip", () => {
  it("compares the take with the words the native said", async () => {
    render();

    await takeScoring();

    expect(scorer.score).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ referenceText: "وين رايح؟" }),
    );
  });

  it("hands over the clip audio so the sound can be compared too", async () => {
    const nativeClipWav = new Blob([new Uint8Array(16)], { type: "audio/wav" });
    render({ nativeClipWav });

    await takeScoring();

    // Word-matching alone passes a learner who said the right words with the
    // wrong sounds, which is most of what shadowing is meant to fix.
    expect(scorer.score).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ nativeClipWav }),
    );
  });

  it("says what it is doing while it works", async () => {
    scorer.score.mockImplementation(() => new Promise(() => {}));
    render();
    await listenThrough();

    const options = recorder.start.mock.calls.at(-1)?.[0] as {
      onComplete: (blob: Blob | null) => void;
    };
    await act(async () => {
      options.onComplete(aTake());
    });

    // "Comparing to the clip" rather than "Scoring": the learner is told what
    // they are being measured against.
    expect(screen.getByText("Comparing to the clip…")).toBeInTheDocument();
  });

  it("shows the score with both halves of it", async () => {
    render();

    await takeScoring();

    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("Words 88 · Sound 74")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
  });

  it("leaves the sound score out when there was no clip audio to compare", async () => {
    render();

    await takeScoring({ acousticSimilarity: null });

    // Claiming an acoustic match that was never measured would be worse than
    // reporting the word match alone.
    expect(screen.getByText("Words 88")).toBeInTheDocument();
    expect(screen.queryByText(/Sound/)).not.toBeInTheDocument();
  });

  it("shows what it heard the learner say", async () => {
    render();

    await takeScoring();

    // Half of "that is not what I said" is the recogniser, and the learner can
    // only tell by reading it back.
    expect(screen.getByText(/Heard: وين رايح/)).toBeInTheDocument();
  });

  it("passes on the coaching tips", async () => {
    render();

    await takeScoring();

    expect(screen.getByText("The ر in رايح is tapped, not rolled.")).toBeInTheDocument();
  });

  it("shows no tips section when the tips call came back empty", async () => {
    render();

    await takeScoring({ tips: [] });

    // The tips are a separate call that can fail on its own; a score with no
    // advice is still a score.
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("offers the failure branch when scoring returned nothing", async () => {
    scorer.score.mockResolvedValue(null);
    render();
    await listenThrough();

    await finishRecording(aTake());

    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // Alongside the cross in the header: a learner who cannot get a score out
    // of the panel needs the way out where they are looking.
    expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(2);
    expect(screen.queryByText("82")).not.toBeInTheDocument();
  });
});

describe("after the score", () => {
  it("replays the line and clears the score on Try again", async () => {
    render();
    await takeScoring();
    player.play.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(screen.queryByText("82")).not.toBeInTheDocument();
  });

  it("closes on Done", async () => {
    const { onClose } = render();
    await takeScoring();

    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));

    // Shadowing one line is meant to be a detour, not a session.
    expect(onClose).toHaveBeenCalled();
  });

  it("stops the microphone when the panel goes away, but not the clip", async () => {
    const { unmount } = render();
    await listenThrough();

    unmount();

    // The recorder is stopped, which is the important half: a panel closed
    // mid-take would otherwise leave the microphone open behind the video.
    expect(recorder.stop).toHaveBeenCalledWith("manual");
    // Pinned: the same cleanup asks the player to pause, and that call never
    // arrives. React detaches the child's imperative handle before the parent's
    // effect cleanup runs, so `playerRef.current` is already null. A clip
    // driving the page's own YouTube player — the ordinary case here, since the
    // panel opens under a video the learner is watching — keeps playing.
    expect(player.pause).not.toHaveBeenCalled();
  });
});
