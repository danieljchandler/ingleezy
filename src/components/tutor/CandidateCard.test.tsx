import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { CandidateCard, type CandidateData } from "./CandidateCard";

/**
 * One word a tutor's recording offered up, waiting to be approved into a deck.
 *
 * The upload pipeline finds candidate words in an audio file and guesses at
 * their meaning, their timings and whether they are the sort of word a picture
 * helps with. All of that is a guess, so every field on this card is editable
 * and nothing reaches the learner's deck until somebody approves it.
 *
 * The audio is what makes the review possible at all. Reading "سوق — market"
 * tells the reviewer nothing about whether the timings caught the word or half
 * of the word before it, so both the word and the sentence it came from can be
 * played back, with a little padding either side so that the clip is audible
 * rather than clipped.
 */

const A_CANDIDATE: CandidateData = {
  id: "cand-1",
  word_text: "سوق",
  word_english: "market",
  sentence_text: "رحت السوق أمس",
  sentence_english: "I went to the market yesterday",
  word_start_ms: 1000,
  word_end_ms: 1500,
  sentence_start_ms: 800,
  sentence_end_ms: 3000,
  confidence: 0.9,
  classification: "CONCRETE",
  status: "pending",
  image_enabled: true,
};

const AUDIO = "https://audio.test/lesson.mp3";

let audios: HTMLAudioElement[] = [];
const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
const pause = HTMLMediaElement.prototype.pause as ReturnType<typeof vi.fn>;

let cleanup: (() => void) | undefined;

beforeEach(() => {
  audios = [];
  play.mockClear();
  pause.mockClear();
  const RealAudio = window.Audio;
  vi.stubGlobal(
    "Audio",
    class extends RealAudio {
      constructor(src?: string) {
        super(src);
        audios.push(this as unknown as HTMLAudioElement);
      }
    },
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

function render(over: Partial<CandidateData> = {}, audioUrl: string | null = AUDIO) {
  const onUpdate = vi.fn();
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const harness = renderWithProviders(
    <CandidateCard
      candidate={{ ...A_CANDIDATE, ...over }}
      audioUrl={audioUrl}
      onUpdate={onUpdate}
      onApprove={onApprove}
      onReject={onReject}
    />,
    { persona: "admin" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onUpdate, onApprove, onReject };
}

/** The two transport buttons, word first and sentence second. */
const playButtons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).filter(
    (b) => b.querySelector(".lucide-play, .lucide-pause") !== null,
  );

describe("reading the candidate", () => {
  it("shows the word, its meaning and the sentence it came from", () => {
    render();

    expect(screen.getByDisplayValue("سوق")).toHaveAttribute("dir", "rtl");
    expect(screen.getByDisplayValue("market")).toBeInTheDocument();
    expect(screen.getByDisplayValue("رحت السوق أمس")).toBeInTheDocument();
    expect(screen.getByText("I went to the market yesterday")).toBeInTheDocument();
  });

  it("says what kind of word the pipeline thought it was", () => {
    render({ classification: "ABSTRACT" });

    expect(screen.getByText("abstract")).toBeInTheDocument();
  });

  it("flags a word the pipeline was unsure of", () => {
    render({ confidence: 0.4 });

    // The reviewer has dozens of these to get through; the warning is what
    // tells them which ones deserve a listen.
    expect(screen.getByText(/ثقة منخفضة/)).toBeInTheDocument();
  });

  it("drops the warning once the word has been decided", () => {
    render({ confidence: 0.4, status: "approved" });

    expect(screen.queryByText(/Low confidence/)).not.toBeInTheDocument();
  });

  it("renders a candidate the pipeline found no sentence for", () => {
    render({ sentence_text: undefined, sentence_english: undefined });

    // Plenty of words are said in isolation; the card still has to work.
    expect(screen.getByDisplayValue("سوق")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("رحت السوق أمس")).toBeNull();
  });
});

describe("hearing it", () => {
  it("plays the word with a little air either side", () => {
    const { container } = render();

    fireEvent.click(playButtons(container)[0]);

    // A clip cut exactly on the word's boundaries sounds truncated, and a
    // reviewer cannot tell a bad timing from a bad cut.
    expect(audios[0].currentTime).toBe(0.75);
    expect(play).toHaveBeenCalled();
  });

  it("does not seek before the beginning of the recording", () => {
    const { container } = render({ word_start_ms: 100, word_end_ms: 400 });

    fireEvent.click(playButtons(container)[0]);

    expect(audios[0].currentTime).toBe(0);
  });

  it("stops at the end of the clip rather than playing on", () => {
    const { container } = render();
    fireEvent.click(playButtons(container)[0]);
    pause.mockClear();

    audios[0].currentTime = 1.8;
    fireEvent(audios[0], new Event("timeupdate"));

    // The next word is a second away; playing into it is how a reviewer
    // approves the wrong timings.
    expect(pause).toHaveBeenCalled();
  });

  it("plays the sentence over its own span", () => {
    const { container } = render();

    fireEvent.click(playButtons(container)[1]);

    expect(audios[0].currentTime).toBe(0.55);
  });

  it("stops on a second press", () => {
    const { container } = render();
    fireEvent.click(playButtons(container)[0]);
    pause.mockClear();

    fireEvent.click(playButtons(container)[0]);

    expect(pause).toHaveBeenCalled();
  });

  it("offers no playback when the recording is not available", () => {
    const { container } = render({}, null);

    // The audio is uploaded separately and may still be processing.
    for (const button of playButtons(container)) {
      expect(button).toBeDisabled();
    }
  });

  it("cannot play a sentence with no timings", () => {
    const { container } = render({ sentence_start_ms: undefined, sentence_end_ms: undefined });

    expect(playButtons(container)[1]).toBeDisabled();
  });

  it("leaves the word button showing as playing when the sentence starts", () => {
    const { container } = render();
    fireEvent.click(playButtons(container)[0]);

    fireEvent.click(playButtons(container)[1]);

    // Pinned: starting the second clip pauses the first, but only the new
    // button's state is set — the word button keeps its pause icon, so the card
    // says two clips are playing when one is.
    const [word, sentence] = playButtons(container);
    expect(word.querySelector(".lucide-pause")).not.toBeNull();
    expect(sentence.querySelector(".lucide-pause")).not.toBeNull();
  });
});

describe("correcting it", () => {
  it("reports an edit to the Arabic", () => {
    const { onUpdate } = render();

    fireEvent.change(screen.getByDisplayValue("سوق"), { target: { value: "السوق" } });

    expect(onUpdate).toHaveBeenCalledWith("cand-1", { word_text: "السوق" });
  });

  it("reports an edit to the meaning", () => {
    const { onUpdate } = render();

    fireEvent.change(screen.getByDisplayValue("market"), { target: { value: "souq" } });

    expect(onUpdate).toHaveBeenCalledWith("cand-1", { word_english: "souq" });
  });

  it("reports an edit to the sentence", () => {
    const { onUpdate } = render();

    fireEvent.change(screen.getByDisplayValue("رحت السوق أمس"), {
      target: { value: "رحت السوق" },
    });

    expect(onUpdate).toHaveBeenCalledWith("cand-1", { sentence_text: "رحت السوق" });
  });

  it("drops the sentence and its timings together", () => {
    const { onUpdate } = render();

    fireEvent.click(screen.getByTitle("احذف الجملة"));

    // A sentence the pipeline mis-segmented is worse than none: it becomes the
    // example on the learner's card.
    expect(onUpdate).toHaveBeenCalledWith("cand-1", {
      sentence_text: undefined,
      sentence_english: undefined,
      sentence_start_ms: undefined,
      sentence_end_ms: undefined,
    });
  });

  it("lets the reviewer decide whether a picture is worth generating", () => {
    const { onUpdate } = render();

    fireEvent.click(screen.getByRole("switch"));

    expect(onUpdate).toHaveBeenCalledWith("cand-1", { image_enabled: false });
  });

  it("warns before generating a picture of an abstract word", () => {
    render({ classification: "ABSTRACT", image_enabled: true });

    // An illustration of "however" costs money and teaches nothing.
    expect(screen.getByText(/الصورة قد ما تفيد/)).toBeInTheDocument();
  });

  it("says nothing about pictures for a word that has one turned off", () => {
    render({ classification: "ABSTRACT", image_enabled: false });

    expect(screen.queryByText(/الصورة قد ما تفيد/)).toBeNull();
  });
});

describe("deciding", () => {
  it("approves the candidate", () => {
    const { onApprove } = render();

    fireEvent.click(screen.getByRole("button", { name: /اقبل/ }));

    expect(onApprove).toHaveBeenCalledWith("cand-1");
  });

  it("rejects the candidate", () => {
    const { onReject } = render();

    fireEvent.click(screen.getByRole("button", { name: /ارفض/ }));

    expect(onReject).toHaveBeenCalledWith("cand-1");
  });

  it("freezes the fields once a decision is made", () => {
    render({ status: "approved" });

    // The approved text is what was queued for image and audio generation;
    // editing it afterwards would leave the two out of step.
    expect(screen.getByDisplayValue("سوق")).toBeDisabled();
    expect(screen.getByDisplayValue("market")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("shows the decision instead of the buttons", () => {
    render({ status: "approved" });

    expect(screen.getByText("مقبولة")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /اقبل/ })).toBeNull();
  });

  it("marks a rejected candidate without hiding it", () => {
    render({ status: "rejected" });

    // Still readable, so a reviewer can see what they turned down without
    // re-running the pipeline.
    expect(screen.getByText("مرفوضة")).toBeInTheDocument();
    expect(screen.getByDisplayValue("سوق")).toBeInTheDocument();
  });

  it("offers no way back from a decision", () => {
    render({ status: "rejected" });

    // Pinned: neither Approve nor Reject survives the decision and there is no
    // undo on the card, so a mis-tap on a fifty-word list is only recoverable
    // from wherever the parent page keeps the list.
    expect(screen.queryByRole("button", { name: /اقبل/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ارفض/ })).toBeNull();
  });
});
