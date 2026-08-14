import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aProfile, TEST_USER_ID } from "@/test/support/factories";
import { SentencePracticeSheet } from "./SentencePracticeSheet";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Free production practice: say any ENGLISH sentence using this word, and get
 * told whether it worked.
 *
 * Every other speaking exercise in the app scores a learner against a fixed
 * target — repeat this, read that. This one has no target. The learner makes
 * up a sentence, which is the thing they will actually have to do in a
 * conversation, and the only honest questions to ask about it are "did you use
 * the word" and "would a native have understood you".
 *
 * The coaching is bilingual by design: the rewrites are English (the thing
 * being learned), the verdict/tips/interference notes come back in the
 * learner's own dialect. And it is deliberately not a score — a model that
 * always finds three things to correct teaches a learner their English is
 * always wrong.
 */

const TARGET = "market";
const GLOSS = "سوق";

// The recorder is driven by useShadowRecorder, which owns getUserMedia, an
// AudioContext analyser for the level meter and the silence detector. Mocked
// here so the sheet's own states are reachable; the recorder has its own tests.
const start = vi.fn();
const stop = vi.fn();
let recorderState = { isRecording: false, level: 0, permissionDenied: false };

vi.mock("@/hooks/useShadowRecorder", () => ({
  useShadowRecorder: () => ({ start, stop, ...recorderState }),
}));

interface CompleteArgs {
  blob: Blob | null;
  reason?: string;
}

/** Deliver the recorder's result, as it would when the learner stops talking. */
const finishRecording = async ({ blob, reason }: CompleteArgs) => {
  const options = start.mock.calls.at(-1)?.[0] as {
    onComplete: (blob: Blob | null, reason?: string) => void;
  };
  await act(async () => {
    options.onComplete(blob, reason);
  });
};

const aTake = () => new Blob([new Uint8Array(32)], { type: "audio/webm" });

const aCoaching = (over: Record<string, unknown> = {}) => ({
  used_target_word: true,
  understandable: true,
  verdict_ar: "واضح ومفهوم، عاش!",
  transcript: "I go to market yesterday",
  natural_rewrite: "I went to the market yesterday",
  natural_rewrite_arabic: "رحت السوق أمس",
  alternatives: [{ english: "I headed to the market", arabic: "سرت السوق" }],
  tips_ar: ["قل went مو go لما تتكلم عن أمس"],
  interference_notes: [{ category: "article", note_ar: "لا تنسَ the قبل market" }],
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  start.mockReset();
  stop.mockReset();
  recorderState = { isRecording: false, level: 0, permissionDenied: false };
  localStorage.clear();
  // jsdom's Blob has no arrayBuffer, and the take is base64-encoded before it
  // is sent.
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
      return Promise.resolve(new ArrayBuffer(this.size));
    };
  }
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function render(seed: (backend: SupabaseBackend) => void = () => {}, open = true) {
  localStorage.setItem("ingleezy_dialect_module", "Gulf");
  const harness = renderWithProviders(
    <SentencePracticeSheet
      open={open}
      onOpenChange={() => {}}
      targetEnglish={TARGET}
      targetArabic={GLOSS}
    />,
    {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("profiles", [
          aProfile({ user_id: TEST_USER_ID, preferred_dialect: "Gulf" }),
        ]);
        backend.stubFunction("practice-sentence-coach", aCoaching());
        seed(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

const record = () => fireEvent.click(screen.getByRole("button", { name: /ابدأ التسجيل|جرّب مرة ثانية/ }));

describe("setting the exercise", () => {
  it("names the word the sentence has to use", () => {
    render();

    // Without the word on screen the exercise is "say something", which is not
    // an exercise. The Arabic gloss rides along as scaffold.
    expect(screen.getByText(TARGET)).toBeInTheDocument();
    expect(screen.getByText(GLOSS)).toBeInTheDocument();
  });

  it("tells the learner not to worry about their accent", () => {
    render();

    // This is a production exercise, not a pronunciation one. A learner who
    // thinks they are being marked on their ع will say less, which defeats it.
    expect(screen.getByText(/pronunciation doesn't\s+need to be perfect/i)).toBeInTheDocument();
  });

  it("says how long they have", () => {
    render();

    expect(screen.getByText("يسجّل لين ١٥ ثانية.")).toBeInTheDocument();
  });
});

describe("recording", () => {
  it("gives the learner fifteen seconds and stops on a pause", () => {
    render();

    record();

    // Long enough for a real sentence and short enough that a learner who
    // freezes is not left recording silence; the trailing-silence stop is what
    // means they never have to find the stop button.
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ maxDurationMs: 15_000, trailingSilenceMs: 1200 }),
    );
  });

  it("offers a manual stop while it is listening", () => {
    recorderState = { ...recorderState, isRecording: true };
    render();

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    expect(stop).toHaveBeenCalledWith("manual");
  });

  it("says the microphone was refused rather than offering a dead button", () => {
    recorderState = { ...recorderState, permissionDenied: true };
    render();

    // A record button that silently does nothing reads as the app being broken
    // rather than as a permission the learner can grant.
    expect(screen.getByText(/microphone access denied/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ابدأ التسجيل|جرّب مرة ثانية/ })).not.toBeInTheDocument();
  });

  it("asks the learner to speak up when nothing was heard", async () => {
    const { backend } = render();
    record();

    await finishRecording({ blob: null, reason: "no-audio" });

    // Sending silence to the coach would come back as "you did not use the
    // word", which blames the learner for a microphone problem.
    expect(screen.getByText(/ما سمعنا شي/)).toBeInTheDocument();
    expect(backend.callsTo("practice-sentence-coach")).toEqual([]);
  });
});

describe("the coaching", () => {
  it("sends the take with the word and the dialect", async () => {
    const { backend } = render();
    record();

    await finishRecording({ blob: aTake() });

    await waitFor(() =>
      expect(backend.lastCallTo("practice-sentence-coach")?.body).toMatchObject({
        targetEnglish: TARGET,
        targetArabic: GLOSS,
        dialect: "Gulf",
        mimeType: "audio/webm",
      }),
    );
  });

  it("shows what the learner actually said", async () => {
    render();
    record();

    await finishRecording({ blob: aTake() });

    // The transcript is the first thing to check: half of "that is not what I
    // said" is the recogniser, and the learner can only tell by reading it.
    await waitFor(() => expect(screen.getByText("You said")).toBeInTheDocument());
  });

  it("answers the two questions the exercise asks", async () => {
    render();
    record();

    await finishRecording({ blob: aTake() });

    // Used the word, and understandable. Not a score — a score on a sentence
    // the learner invented would be scoring their imagination.
    await waitFor(() => expect(screen.getByText("Used target word")).toBeInTheDocument());
    expect(screen.getByText("Understandable")).toBeInTheDocument();
  });

  it("offers a more natural English phrasing with its Arabic gloss", async () => {
    render();
    record();

    await finishRecording({ blob: aTake() });

    await waitFor(() => expect(screen.getByText("More natural")).toBeInTheDocument());
    expect(screen.getByText("I went to the market yesterday")).toBeInTheDocument();
    expect(screen.getByText("رحت السوق أمس")).toBeInTheDocument();
  });

  it("names the interference patterns in the learner's own dialect", async () => {
    render();
    record();

    await finishRecording({ blob: aTake() });

    // The L1-aware part of the coaching: the pattern is named, and the
    // explanation is in the learner's language, not the one they are learning.
    await waitFor(() => expect(screen.getByText("From Arabic to English")).toBeInTheDocument());
    expect(screen.getByText("article")).toBeInTheDocument();
    expect(screen.getByText("لا تنسَ the قبل market")).toBeInTheDocument();
  });

  it("offers other ways to say it", async () => {
    render();
    record();

    await waitFor(() => expect(start).toHaveBeenCalled());
    await finishRecording({ blob: aTake() });

    await waitFor(() => expect(screen.getByText("Other ways to say it")).toBeInTheDocument());
    expect(screen.getByText("I headed to the market")).toBeInTheDocument();
  });

  it("shows the tips when there are any", async () => {
    render();
    record();

    await finishRecording({ blob: aTake() });

    await waitFor(() =>
      expect(screen.getByText("قل went مو go لما تتكلم عن أمس")).toBeInTheDocument(),
    );
  });

  it("leaves out the sections the coach had nothing for", async () => {
    render((backend) =>
      backend.stubFunction(
        "practice-sentence-coach",
        aCoaching({ natural_rewrite: null, alternatives: [], tips_ar: [], interference_notes: [] }),
      ),
    );
    record();

    await finishRecording({ blob: aTake() });

    // A model that always finds three things to correct teaches a learner that
    // their Arabic is always wrong. An empty section is the honest answer when
    // the sentence was simply fine.
    await waitFor(() => expect(screen.getByText("Used target word")).toBeInTheDocument());
    expect(screen.queryByText("More natural")).not.toBeInTheDocument();
    expect(screen.queryByText("Other ways to say it")).not.toBeInTheDocument();
    expect(screen.queryByText("Tips")).not.toBeInTheDocument();
    expect(screen.queryByText("From Arabic to English")).not.toBeInTheDocument();
  });

  it("passes on the coach's own explanation when it had nothing to say", async () => {
    render((backend) =>
      backend.stubFunction("practice-sentence-coach", {
        empty: true,
        message: "We couldn't make out a sentence — try again.",
      }),
    );
    record();

    await finishRecording({ blob: aTake() });

    await waitFor(() =>
      expect(
        screen.getByText("We couldn't make out a sentence — try again."),
      ).toBeInTheDocument(),
    );
  });
});

describe("going again", () => {
  it("offers another attempt once the feedback is in", async () => {
    render();
    record();
    await finishRecording({ blob: aTake() });
    await waitFor(() => expect(screen.getByText("Used target word")).toBeInTheDocument());

    // Two ways back to the microphone, because the button at the top has moved
    // off screen by the time the learner has read the coaching.
    expect(screen.getByRole("button", { name: "جرّب مرة ثانية" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try another sentence/i })).toBeInTheDocument();
  });

  it("clears the previous coaching before the new take", async () => {
    render();
    record();
    await finishRecording({ blob: aTake() });
    await waitFor(() => expect(screen.getByText("Used target word")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /try another sentence/i }));

    // Coaching for the sentence before, sitting under a recording in progress,
    // reads as feedback on what is being said right now.
    expect(screen.queryByText("Used target word")).not.toBeInTheDocument();
  });
});

describe("when the coach fails", () => {
  it("says so rather than leaving the learner waiting", async () => {
    render((backend) => backend.stubFunctionFailure("practice-sentence-coach", 500));
    record();

    await finishRecording({ blob: aTake() });

    // They have already spoken; a spinner that stops with nothing on screen
    // reads as the app having lost their sentence.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "جرّب مرة ثانية" })).toBeInTheDocument(),
    );
  });

  it("treats an error returned with a 200 as a failure", async () => {
    render((backend) =>
      backend.stubFunction("practice-sentence-coach", { error: "transcription unavailable" }),
    );
    record();

    await finishRecording({ blob: aTake() });

    await waitFor(() =>
      expect(screen.getByText("transcription unavailable")).toBeInTheDocument(),
    );
  });

  it("ignores a take that lands after the sheet was closed", async () => {
    const harness = render();
    record();
    harness.rerender(
      <SentencePracticeSheet
        open={false}
        onOpenChange={() => {}}
        targetEnglish={TARGET}
        targetArabic={GLOSS}
      />,
    );

    await finishRecording({ blob: aTake() });

    // The recorder finishes on its own timer, so a learner who dismisses the
    // sheet mid-sentence would otherwise pay for coaching they will never see.
    expect(harness.backend.callsTo("practice-sentence-coach")).toEqual([]);
  });
});
