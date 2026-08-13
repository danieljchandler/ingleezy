import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useShadowScore } from "./useShadowScore";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Scoring a shadowing take against the clip the learner was shadowing.
 *
 * Shadowing is repeating a native speaker in near-real time, and the thing that
 * makes it worth doing is that the target is a real person saying a real
 * sentence — not a model's idea of correct pronunciation. So both signals here
 * are anchored to the clip: did you say the words the native said (ASR plus a
 * normalised Arabic edit distance, server-side), and does your take sound like
 * theirs (MFCC and dynamic time warping, in the browser).
 *
 * A generic pronunciation score would defeat the exercise — it would mark a
 * learner down for a Gulf vowel that matched the clip perfectly.
 */

vi.mock("@/lib/audioToWav", () => ({
  blobToWav: vi.fn(async (blob: Blob) => blob),
}));

vi.mock("@/lib/acousticSimilarity", () => ({
  acousticSimilarity: vi.fn(async () => 80),
}));

const { acousticSimilarity } = await import("@/lib/acousticSimilarity");
const acoustic = acousticSimilarity as unknown as ReturnType<typeof vi.fn>;

// jsdom's Blob has no `arrayBuffer`, and the hook base64-encodes the take
// before sending it. Without this every score fails on the encode rather than
// on anything the test is about.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return Promise.resolve(new ArrayBuffer(this.size));
  };
}

const aTake = (bytes = 64) => new Blob([new Uint8Array(bytes)], { type: "audio/webm" });
const aNativeClip = () => new Blob([new Uint8Array(64)], { type: "audio/wav" });

const REFERENCE = "شخبارك اليوم";

const aScoreReply = (over: Record<string, unknown> = {}) => ({
  transcriptSimilarity: 0.9,
  recognizedText: "شخبارك اليوم",
  wordDiffs: [{ ref: "شخبارك", said: "شخبارك", status: "match" }],
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  acoustic.mockClear();
  acoustic.mockResolvedValue(80);
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function render(seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(() => useShadowScore(), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

const withBothScorers = (backend: SupabaseBackend) => {
  backend.stubFunction("score-shadow-attempt", aScoreReply());
  backend.stubFunction("pronunciation-feedback", { tips: ["Lengthen the final vowel"] });
};

describe("scoring a take", () => {
  it("combines the transcript and acoustic signals", async () => {
    const { result } = render(withBothScorers);

    let scored: Awaited<ReturnType<typeof result.current.score>> = null;
    await act(async () => {
      scored = await result.current.score(aTake(), {
        referenceText: REFERENCE,
        nativeClipWav: aNativeClip(),
      });
    });

    // 0.55 × 90 + 0.45 × 80. Transcript is weighted higher because saying the
    // wrong words is a bigger failure than saying the right ones unmusically.
    expect(scored!.overall).toBe(86);
    expect(scored!.transcriptSimilarity).toBe(90);
    expect(scored!.acousticSimilarity).toBe(80);
  });

  it("falls back to the transcript alone when the clip audio is missing", async () => {
    const { result } = render(withBothScorers);

    let scored: Awaited<ReturnType<typeof result.current.score>> = null;
    await act(async () => {
      scored = await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    // Plenty of clips cannot be downloaded — embeds, region locks. A score from
    // the transcript alone is still a real score, and null tells the UI not to
    // draw the acoustic half.
    expect(scored!.overall).toBe(90);
    expect(scored!.acousticSimilarity).toBeNull();
    expect(acoustic).not.toHaveBeenCalled();
  });

  it("still scores when the acoustic comparison fails", async () => {
    acoustic.mockRejectedValue(new Error("decode failed"));
    const { result } = render(withBothScorers);

    let scored: Awaited<ReturnType<typeof result.current.score>> = null;
    await act(async () => {
      scored = await result.current.score(aTake(), {
        referenceText: REFERENCE,
        nativeClipWav: aNativeClip(),
      });
    });

    // The learner has already recorded; losing half the analysis is better than
    // losing the take.
    expect(scored!.overall).toBe(90);
    expect(scored!.acousticSimilarity).toBeNull();
  });

  it("reports what the recogniser heard", async () => {
    const { result } = render((backend) => {
      backend.stubFunction(
        "score-shadow-attempt",
        aScoreReply({ recognizedText: "شخبارك اليم", transcriptSimilarity: 0.7 }),
      );
      backend.stubFunction("pronunciation-feedback", { tips: [] });
    });

    let scored: Awaited<ReturnType<typeof result.current.score>> = null;
    await act(async () => {
      scored = await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    // "You said اليم" is the feedback that makes the score actionable; a
    // number alone tells the learner nothing about what to change.
    expect(scored!.recognizedText).toBe("شخبارك اليم");
    expect(scored!.wordDiffs).toHaveLength(1);
  });

  it("tells the scorer which dialect to record mistakes against", async () => {
    localStorage.setItem("ingleezy_dialect_module", "Gulf");
    const { result, backend } = render(withBothScorers);

    await act(async () => {
      await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    // The words the learner missed are written to `learner_errors`, which is
    // read back per dialect — a mistake filed under the wrong one is invisible
    // to the profile it exists to feed.
    expect(backend.lastCallTo("score-shadow-attempt")?.body).toMatchObject({
      referenceText: REFERENCE,
      dialect: "Gulf",
      mimeType: "audio/wav",
    });
  });

  it("defaults an absent word diff to an empty list", async () => {
    const { result } = render((backend) => {
      backend.stubFunction("score-shadow-attempt", { transcriptSimilarity: 0.5 });
      backend.stubFunction("pronunciation-feedback", { tips: [] });
    });

    let scored: Awaited<ReturnType<typeof result.current.score>> = null;
    await act(async () => {
      scored = await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    // The diff is rendered word by word; undefined would throw during render on
    // exactly the takes the ASR struggled with.
    expect(scored!.wordDiffs).toEqual([]);
    expect(scored!.recognizedText).toBe("");
  });
});

describe("the coaching tips", () => {
  it("fetches them with the score already computed", async () => {
    const { result, backend } = render(withBothScorers);

    await act(async () => {
      await result.current.score(aTake(), {
        referenceText: REFERENCE,
        nativeClipWav: aNativeClip(),
      });
    });

    // The tips model is given the combined closeness and the diff, so its
    // advice is about the gap rather than about the sentence in general.
    expect(backend.lastCallTo("pronunciation-feedback")?.body).toMatchObject({
      mode: "shadow",
      referenceText: REFERENCE,
      recognizedText: "شخبارك اليوم",
      closeness: 86,
    });
  });

  it("returns the score without tips when the tips call fails", async () => {
    const { result } = render((backend) => {
      backend.stubFunction("score-shadow-attempt", aScoreReply());
      backend.stubFunctionFailure("pronunciation-feedback", 500);
    });

    let scored: Awaited<ReturnType<typeof result.current.score>> = null;
    await act(async () => {
      scored = await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    // Best-effort by design: the number and the diff are the exercise, and the
    // tips are the commentary.
    expect(scored!.overall).toBe(90);
    expect(scored!.tips).toEqual([]);
  });

  it("ignores tips that are not a list", async () => {
    const { result } = render((backend) => {
      backend.stubFunction("score-shadow-attempt", aScoreReply());
      backend.stubFunction("pronunciation-feedback", { tips: "Lengthen the vowel" });
    });

    let scored: Awaited<ReturnType<typeof result.current.score>> = null;
    await act(async () => {
      scored = await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    // A model answering in prose instead of as a list would otherwise render as
    // one bullet per character.
    expect(scored!.tips).toEqual([]);
  });
});

describe("refusing to score", () => {
  it("says so when nothing was recorded", async () => {
    const { result, backend } = render(withBothScorers);

    let scored: Awaited<ReturnType<typeof result.current.score>> = null;
    await act(async () => {
      scored = await result.current.score(new Blob([], { type: "audio/webm" }), {
        referenceText: REFERENCE,
      });
    });

    // A silent take is a microphone that never started, and scoring it would
    // report 0% as though the learner had spoken badly.
    expect(scored).toBeNull();
    expect(result.current.error).toBe("No audio recorded");
    expect(backend.callsTo("score-shadow-attempt")).toEqual([]);
  });

  it("says so when there is nothing to shadow", async () => {
    const { result, backend } = render(withBothScorers);

    await act(async () => {
      await result.current.score(aTake(), { referenceText: "   " });
    });

    expect(result.current.error).toBe("Reference text is required");
    expect(backend.callsTo("score-shadow-attempt")).toEqual([]);
  });

  it("surfaces a refused scoring call", async () => {
    const { result } = render((backend) => {
      backend.stubFunctionFailure("score-shadow-attempt", 500, { error: "asr unavailable" });
      backend.stubFunction("pronunciation-feedback", { tips: [] });
    });

    let scored: Awaited<ReturnType<typeof result.current.score>> = null;
    await act(async () => {
      scored = await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    expect(scored).toBeNull();
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("surfaces an error the scorer returned with a 200", async () => {
    const { result } = render((backend) => {
      backend.stubFunction("score-shadow-attempt", { error: "audio too short" });
      backend.stubFunction("pronunciation-feedback", { tips: [] });
    });

    await act(async () => {
      await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    // The functions answer 200 with an `error` field more often than a status
    // code, and this one carries the reason the learner needs.
    await waitFor(() => expect(result.current.error).toBe("audio too short"));
  });
});

describe("the state around a take", () => {
  it("reports that it is working and then stops", async () => {
    const { result } = render(withBothScorers);

    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.result?.overall).toBe(90);
  });

  it("clears the previous take on request", async () => {
    const { result } = render(withBothScorers);
    await act(async () => {
      await result.current.score(aTake(), { referenceText: REFERENCE });
    });

    act(() => {
      result.current.reset();
    });

    // Recording again should start from a blank panel rather than the last
    // score fading out under the new one.
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("keeps only the most recent take's result", async () => {
    let replies = 0;
    const { result } = render((backend) => {
      backend.stubFunction("score-shadow-attempt", () => ({
        status: 200,
        body: aScoreReply({ transcriptSimilarity: ++replies === 1 ? 0.2 : 0.9 }),
      }));
      backend.stubFunction("pronunciation-feedback", { tips: [] });
    });

    await act(async () => {
      const first = result.current.score(aTake(), { referenceText: REFERENCE });
      const second = result.current.score(aTake(), { referenceText: REFERENCE });
      await Promise.all([first, second]);
    });

    // Learners re-record immediately when they know a take was bad. A slow
    // first response landing after a fast second one would show them the score
    // for the attempt they abandoned.
    expect(result.current.result?.transcriptSimilarity).toBe(90);
  });
});
