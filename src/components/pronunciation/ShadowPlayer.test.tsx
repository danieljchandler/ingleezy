import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ShadowPlayer } from "./ShadowPlayer";
import type { PronunciationResult } from "@/hooks/useAzurePronunciation";
import type { ShadowClip } from "@/hooks/useShadowQueue";

/**
 * One shadowing take: listen to a native speaker say a line, repeat it
 * immediately, get scored on how close you came.
 *
 * Shadowing only works if the gap between hearing and speaking is short — that
 * is the whole mechanism, and it is why the microphone opens by itself the
 * instant the clip stops rather than waiting for a button. The reference is
 * always the real clip, never text-to-speech: a learner who matches a synthetic
 * voice has learned to sound like a synthetic voice.
 *
 * The parts this component owns are the state machine and the recovery paths.
 * Playback, recording and scoring each live behind their own interface and are
 * stubbed here so that every branch of that machine is reachable — including
 * the ones a real microphone would make hard to provoke.
 */

const player = vi.hoisted(() => ({
  play: vi.fn(async (_rate?: number) => true),
  pause: vi.fn(),
  onEnded: null as null | (() => void),
  onError: null as null | ((message: string) => void),
}));

const recorder = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  level: 0,
  error: null as string | null,
  permissionDenied: false,
  isRecording: false,
}));

const azure = vi.hoisted(() => ({
  assess: vi.fn(),
  result: null as PronunciationResult | null,
  isLoading: false,
  error: null as string | null,
  reset: vi.fn(),
}));

vi.mock("./ClipSourcePlayer", () => ({
  ClipSourcePlayer: forwardRef(
    (
      props: { onEnded: () => void; onError?: (message: string) => void },
      ref: React.Ref<unknown>,
    ) => {
      player.onEnded = props.onEnded;
      player.onError = props.onError ?? null;
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

vi.mock("@/hooks/useAzurePronunciation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAzurePronunciation")>()),
  useAzurePronunciation: () => azure,
}));

const A_CLIP: ShadowClip = {
  id: "clip-1",
  source: "audio",
  audioUrl: "https://audio.test/clip.mp3",
  text: "شلونك اليوم",
  translation: "How are you today?",
  startSec: 2,
  endSec: 5,
  dialect: "Gulf",
  locale: "ar-KW",
  sourceTitle: "Kuwaiti street interview",
};

const aScore = (overall: number): PronunciationResult => ({
  overall,
  accuracy: overall + 1,
  fluency: overall - 2,
  completeness: 100,
  words: [],
  recognizedText: "شلونك اليوم",
  locale: "ar-KW",
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  player.play.mockReset().mockResolvedValue(true);
  player.pause.mockReset();
  recorder.start.mockReset();
  recorder.stop.mockReset();
  recorder.level = 0;
  recorder.error = null;
  recorder.permissionDenied = false;
  recorder.isRecording = false;
  azure.assess.mockReset();
  azure.result = null;
  azure.isLoading = false;
  azure.error = null;
  azure.reset.mockReset().mockImplementation(() => {
    azure.result = null;
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

interface Options {
  clip?: ShadowClip;
  threshold?: number;
  autoAdvance?: boolean;
  showEnglish?: boolean;
}

function render({
  clip = A_CLIP,
  threshold = 75,
  autoAdvance = false,
  showEnglish = false,
}: Options = {}) {
  const onResult = vi.fn();
  const onNext = vi.fn();
  const harness = renderWithProviders(
    <ShadowPlayer
      clip={clip}
      threshold={threshold}
      autoAdvance={autoAdvance}
      showEnglish={showEnglish}
      onResult={onResult}
      onNext={onNext}
    />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onResult, onNext };
}

/** Play the clip through to its end, which is what opens the microphone. */
const listenThrough = async () => {
  fireEvent.click(screen.getByRole("button", { name: /^listen$/i }));
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    player.onEnded?.();
  });
};

/** Hand back whatever the recorder heard, as it would when the learner stops. */
const finishRecording = async (blob: Blob | null, reason?: string) => {
  const options = recorder.start.mock.calls.at(-1)?.[0] as {
    onComplete: (blob: Blob | null, reason?: string) => void | Promise<void>;
  };
  await act(async () => {
    await options.onComplete(blob, reason);
  });
};

const aTake = () => new Blob([new Uint8Array(8)], { type: "audio/webm" });

/** A whole take, from pressing Listen to a score on screen. */
const takeScoring = async (overall: number) => {
  azure.assess.mockImplementation(async () => {
    azure.result = aScore(overall);
    return azure.result;
  });
  await listenThrough();
  await finishRecording(aTake());
};

describe("setting up the take", () => {
  it("shows the line to be repeated", () => {
    render();

    expect(screen.getByText("شلونك اليوم")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText(/Gulf · Kuwaiti street interview/)).toBeInTheDocument();
  });

  it("keeps the English out of the way unless it was asked for", () => {
    render();

    // Reading the English while shadowing turns a listening exercise into a
    // reading one.
    expect(screen.queryByText("How are you today?")).not.toBeInTheDocument();
  });

  it("shows the English when the learner wants it", () => {
    render({ showEnglish: true });

    expect(screen.getByText("How are you today?")).toBeInTheDocument();
  });

  it("plays the clip at full speed to begin with", async () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: /^listen$/i }));

    await waitFor(() => expect(player.play).toHaveBeenCalledWith(1));
  });

  it("plays it slowly when the learner asks", async () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: "0.5×" }));
    fireEvent.click(screen.getByRole("button", { name: /^listen$/i }));

    // Half speed is how a learner hears the consonants they are missing; the
    // reference is still the native voice, just slower.
    await waitFor(() => expect(player.play).toHaveBeenCalledWith(0.5));
  });

  it("goes back to waiting when the clip will not start", async () => {
    player.play.mockResolvedValue(false);
    render();

    fireEvent.click(screen.getByRole("button", { name: /^listen$/i }));

    // A YouTube embed that autoplay blocked must not leave the learner
    // watching a countdown for a clip that is not playing.
    await waitFor(() => expect(screen.getByRole("button", { name: /^listen$/i })).toBeEnabled());
  });
});

describe("the echo window", () => {
  it("opens the microphone the moment the clip stops", async () => {
    render();

    await listenThrough();

    // The gap between hearing and speaking is the exercise. A button to press
    // first would put a decision in the middle of it.
    expect(recorder.start).toHaveBeenCalled();
    expect(screen.getByText("Repeat now")).toBeInTheDocument();
  });

  it("allows the clip's length plus a breath, and stops on the silence after", async () => {
    render();

    await listenThrough();

    // Three seconds of clip, so four and a half to repeat it — enough for a
    // slower learner without recording the room once they have finished.
    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ maxDurationMs: 4500, trailingSilenceMs: 600 }),
    );
  });

  it("gives a very short clip a floor to speak into", async () => {
    render({ clip: { ...A_CLIP, startSec: 2, endSec: 2.2 } });

    await listenThrough();

    // A fifth of a second is a word; the learner still needs time to say it.
    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ maxDurationMs: 2300 }),
    );
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

    // Silence sent to the scorer comes back as a very low score, which blames
    // the learner for a microphone problem.
    expect(screen.getByText("We didn't hear you — try again.")).toBeInTheDocument();
    expect(azure.assess).not.toHaveBeenCalled();
  });

  it("reports a recording that failed for some other reason", async () => {
    render();
    await listenThrough();

    await finishRecording(null, "error");

    expect(screen.getByText("Recording failed")).toBeInTheDocument();
  });

  it("offers another go or a way past after a failed take", async () => {
    render();
    await listenThrough();

    await finishRecording(null, "no-audio");

    // Being stuck on a clip whose microphone will not cooperate is how a
    // learner leaves the exercise.
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("explains a refused microphone rather than showing a bare error", async () => {
    recorder.permissionDenied = true;
    recorder.error = "Microphone blocked";
    render();

    expect(screen.getByText(/enable mic access in your browser/i)).toBeInTheDocument();
  });
});

describe("the score", () => {
  it("scores the take against the line and the clip's own locale", async () => {
    render();

    await takeScoring(82);

    // The locale matters: a Kuwaiti clip assessed as Saudi marks the learner
    // down for matching the speaker they were listening to.
    expect(azure.assess).toHaveBeenCalledWith(expect.any(Blob), A_CLIP.text, "ar-KW");
  });

  it("shows the overall score with the part-scores behind it", async () => {
    render();

    await takeScoring(82);

    expect(screen.getByText("82")).toBeInTheDocument();
    // Accuracy, fluency and completeness are what tell a learner whether to
    // work on sounds, on speed, or on saying the whole thing.
    expect(screen.getByText("Acc 83 · Flu 80 · Comp 100")).toBeInTheDocument();
  });

  it("names the band rather than leaving a bare number", async () => {
    render();

    await takeScoring(92);

    expect(screen.getByText("Excellent")).toBeInTheDocument();
  });

  it("tells the page what was scored", async () => {
    const { onResult } = render();

    await takeScoring(64);

    // The queue uses this to decide what to show next and what to log.
    expect(onResult).toHaveBeenCalledWith(64);
  });

  it("still reports a take the learner failed", async () => {
    const { onResult } = render();

    await takeScoring(40);

    expect(onResult).toHaveBeenCalledWith(40);
    expect(screen.getByText("Needs practice")).toBeInTheDocument();
  });

  it("shows the failure branch when scoring came back with nothing", async () => {
    azure.assess.mockResolvedValue(null);
    render();
    await listenThrough();

    await finishRecording(aTake());

    // Azure returning nothing is not the learner's fault and must not read as
    // a zero.
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Needs practice")).not.toBeInTheDocument();
  });
});

describe("what happens next", () => {
  it("moves on by itself once the learner is over the bar", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: true, threshold: 75 });

    await takeScoring(88);
    expect(screen.getByText(/Advancing…/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1400);
    });

    // A learner who is getting them right should not have to press Next
    // between every line; the pause is long enough to read the score.
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("waits on a take that fell short", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: true, threshold: 75 });

    await takeScoring(60);
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Below the bar the useful thing is another go at the same line.
    expect(onNext).not.toHaveBeenCalled();
  });

  it("waits for the learner when advancing is switched off", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: false, threshold: 75 });

    await takeScoring(95);
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(screen.queryByText(/Advancing…/)).not.toBeInTheDocument();
  });

  it("does not advance twice when the learner presses Next first", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: true, threshold: 75 });
    await takeScoring(88);

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    act(() => {
      vi.advanceTimersByTime(1400);
    });

    // Skipping two clips because the learner was faster than the timer would
    // silently drop a line from the session.
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("skips the line anyway when the learner loops it instead", async () => {
    vi.useFakeTimers();
    const { onNext } = render({ autoAdvance: true, threshold: 75 });
    await takeScoring(88);

    fireEvent.click(screen.getByRole("button", { name: /loop/i }));
    act(() => {
      vi.advanceTimersByTime(1400);
    });

    // Pinned: Loop does not cancel the advance the score started. A learner who
    // scored well and wanted one more go at the same line is moved on to the
    // next one 1.4 seconds later, in the middle of listening to it.
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("plays the clip again and clears the score on Loop", async () => {
    render();
    await takeScoring(88);
    player.play.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /loop/i }));

    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(screen.queryByText("88")).not.toBeInTheDocument();
  });

  it("starts fresh when the queue hands over a new clip", async () => {
    const { rerender } = render();
    await takeScoring(88);

    rerender(
      <ShadowPlayer
        clip={{ ...A_CLIP, id: "clip-2", text: "وين رايح" }}
        threshold={75}
        autoAdvance={false}
        showEnglish={false}
        onResult={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    // The previous line's score sitting under a new line reads as a score for
    // the new one.
    expect(screen.getByText("وين رايح")).toBeInTheDocument();
    expect(screen.queryByText("88")).not.toBeInTheDocument();
  });
});
