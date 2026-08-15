import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { QuizQuestion } from "./QuizQuestion";
import type { VocabularyWord } from "@/hooks/useTopic";

/**
 * The lesson quiz — recognition in one of two modes.
 *
 * Multiple choice and typing are not two skins on the same exercise. Picking
 * "market" from four options tests whether a learner can recognise it; typing
 * it tests whether they can produce it, and the second is a much harder claim
 * about knowing a word. Both are here because the app uses one to warm up to
 * the other.
 *
 * Two things decide whether the exercise is fair. The distractors have to be
 * real alternatives — three other English words from the same lesson, never a
 * repeat of the answer — and once an answer is given it has to stop being
 * changeable, or a learner can hunt for the green one and the score means
 * nothing.
 */

const aWord = (index: number, over: Partial<VocabularyWord> = {}): VocabularyWord =>
  ({
    id: `word-${index}`,
    topic_id: null,
    lesson_id: null,
    word_arabic: `كلمة${index}`,
    word_english: `word ${index}`,
    image_url: null,
    audio_url: null,
    image_position: null,
    display_order: index,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  }) as VocabularyWord;

const TARGET = aWord(0, { word_arabic: "سوق", word_english: "market" });
const OTHERS = [aWord(1), aWord(2), aWord(3), aWord(4), aWord(5)];

let cleanup: (() => void) | undefined;

interface FakeAudio {
  src: string;
  play: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

const audios: FakeAudio[] = [];
const originalAudio = globalThis.Audio;

beforeEach(() => {
  audios.length = 0;
  globalThis.Audio = class {
    src: string;
    play = vi.fn(async () => {});
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(src: string) {
      this.src = src;
      audios.push(this as unknown as FakeAudio);
    }
  } as unknown as typeof Audio;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  globalThis.Audio = originalAudio;
});

function render(props: Partial<React.ComponentProps<typeof QuizQuestion>> = {}) {
  const onAnswer = vi.fn();
  const harness = renderWithProviders(
    <QuizQuestion
      mode="multiple-choice"
      currentWord={TARGET}
      otherWords={OTHERS}
      gradient="bg-gradient-green"
      onAnswer={onAnswer}
      {...props}
    />,
    { persona: "free" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onAnswer };
}

const optionButtons = () =>
  screen
    .getAllByRole("button")
    .filter((button) => /^word \d+$|^market$/.test(button.textContent?.trim() ?? ""));

describe("asking the question", () => {
  it("shows the Arabic word right to left", () => {
    render();

    // The word is the question. Laid out left to right it is a different string
    // of letters.
    expect(screen.getByText("سوق")).toHaveAttribute("dir", "rtl");
  });

  it("asks for the English", () => {
    render();

    expect(screen.getByText("وش هذي بالإنجليزي؟")).toBeInTheDocument();
  });

  it("shows the picture when the word has one", () => {
    render({ currentWord: aWord(0, { word_english: "market", image_url: "https://cdn/x.png" }) });

    // The image is a second route to the meaning, and for a concrete noun it is
    // usually the faster one.
    expect(screen.getByRole("img", { name: "market" })).toHaveAttribute(
      "src",
      "https://cdn/x.png",
    );
  });

  it("leaves a placeholder when it has none", () => {
    render();

    // A missing image must not collapse the layout — the options would jump up
    // the screen between questions.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("hearing the word", () => {
  it("plays the audio when there is any", () => {
    render({
      currentWord: aWord(0, {
        word_english: "market",
        image_url: "https://cdn/x.png",
        audio_url: "https://cdn/market.mp3",
      }),
    });

    fireEvent.click(screen.getAllByRole("button")[0]);

    expect(audios[0].src).toBe("https://cdn/market.mp3");
    expect(audios[0].play).toHaveBeenCalled();
  });

  it("offers nothing to press when the word has no recording", () => {
    render({ currentWord: aWord(0, { word_english: "market", image_url: "https://cdn/x.png" }) });

    // A speaker button that does nothing is worse than no button; the learner
    // presses it twice and concludes their sound is broken.
    expect(optionButtons()).toHaveLength(screen.getAllByRole("button").length);
  });

  it("ignores a second press while it is still playing", () => {
    render({
      currentWord: aWord(0, {
        word_english: "market",
        image_url: "https://cdn/x.png",
        audio_url: "https://cdn/market.mp3",
      }),
    });
    const speaker = screen.getAllByRole("button")[0];

    fireEvent.click(speaker);
    fireEvent.click(speaker);

    // Two overlapping copies of one Arabic word are less intelligible than one.
    expect(audios).toHaveLength(1);
  });
});

describe("multiple choice", () => {
  it("offers four options with the answer among them", () => {
    render();

    const labels = optionButtons().map((button) => button.textContent?.trim());
    expect(labels).toHaveLength(4);
    expect(labels).toContain("market");
  });

  it("never repeats the answer as a distractor", () => {
    render();

    // A duplicated answer makes the question unanswerable and the score a coin
    // flip.
    const labels = optionButtons().map((button) => button.textContent?.trim());
    expect(new Set(labels).size).toBe(4);
  });

  it("draws the distractors from the lesson's other words", () => {
    render();

    const labels = optionButtons().map((button) => button.textContent?.trim());
    for (const label of labels) {
      if (label === "market") continue;
      // Distractors from elsewhere would be trivially eliminable; from the same
      // lesson they are words the learner is actually meant to tell apart.
      expect(OTHERS.map((word) => word.word_english)).toContain(label);
    }
  });

  it("copes with a lesson too small to fill the options", () => {
    render({ otherWords: [aWord(1)] });

    // The last lesson in a topic can have two words in it, and the quiz still
    // has to run.
    expect(optionButtons().length).toBeGreaterThanOrEqual(2);
  });

  it("reports a right answer", () => {
    const { onAnswer } = render();

    fireEvent.click(screen.getByRole("button", { name: "market" }));

    expect(onAnswer).toHaveBeenCalledWith(true, "market");
    expect(screen.getByText("صح! أحسنت")).toBeInTheDocument();
  });

  it("reports a wrong answer with what was chosen", () => {
    const { onAnswer } = render();
    const wrong = optionButtons().find((button) => button.textContent?.trim() !== "market")!;
    const chosen = wrong.textContent!.trim();

    fireEvent.click(wrong);

    // The chosen answer is recorded, not just the verdict — which word a
    // learner confused it with is the useful half.
    expect(onAnswer).toHaveBeenCalledWith(false, chosen);
    expect(screen.getByText("مو بالضبط — واصل التمرين")).toBeInTheDocument();
  });

  it("stops accepting answers once one is given", () => {
    const { onAnswer } = render();
    const wrong = optionButtons().find((button) => button.textContent?.trim() !== "market")!;

    fireEvent.click(wrong);
    fireEvent.click(screen.getByRole("button", { name: "market" }));

    // Otherwise a learner hunts for the green one and the score is meaningless.
    expect(onAnswer).toHaveBeenCalledTimes(1);
    for (const button of optionButtons()) expect(button).toBeDisabled();
  });

  it("keeps the same options across a re-render", () => {
    const { rerender } = render();
    const before = optionButtons().map((button) => button.textContent?.trim());

    rerender(
      <QuizQuestion
        mode="multiple-choice"
        currentWord={TARGET}
        otherWords={OTHERS}
        gradient="bg-gradient-green"
        onAnswer={() => {}}
      />,
    );

    // The options are shuffled once per word. Reshuffling on every render would
    // move them under the learner's finger as they reached for one.
    expect(optionButtons().map((button) => button.textContent?.trim())).toEqual(before);
  });

  it("starts fresh on the next word", () => {
    const { rerender, onAnswer } = render();
    fireEvent.click(screen.getByRole("button", { name: "market" }));

    rerender(
      <QuizQuestion
        mode="multiple-choice"
        currentWord={aWord(9, { word_arabic: "مطعم", word_english: "restaurant" })}
        otherWords={OTHERS}
        gradient="bg-gradient-green"
        onAnswer={onAnswer}
      />,
    );

    // The result banner from the previous word carrying over would tell the
    // learner they had answered a question they have not seen.
    expect(screen.queryByText("صح! أحسنت")).not.toBeInTheDocument();
    expect(screen.getByText("مطعم")).toBeInTheDocument();
  });
});

describe("typing the answer", () => {
  const typeAndSubmit = (text: string) => {
    fireEvent.change(screen.getByPlaceholderText("اكتب الكلمة بالإنجليزي…"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "تحقّق" }));
  };

  it("accepts the right word", () => {
    const { onAnswer } = render({ mode: "typing" });

    typeAndSubmit("market");

    expect(onAnswer).toHaveBeenCalledWith(true, "market");
    expect(screen.getByText("صح! أحسنت")).toBeInTheDocument();
  });

  it("ignores case and surrounding space", () => {
    const { onAnswer } = render({ mode: "typing" });

    typeAndSubmit("  Market  ");

    // The exercise is whether they know the word, not whether they hold shift.
    // The trimmed original is reported so the record shows what they typed.
    expect(onAnswer).toHaveBeenCalledWith(true, "Market");
  });

  it("shows the answer when they get it wrong", () => {
    const { onAnswer } = render({ mode: "typing" });

    typeAndSubmit("shop");

    // Being told you are wrong without being told what was right is the one
    // thing a quiz must not do.
    expect(onAnswer).toHaveBeenCalledWith(false, "shop");
    expect(screen.getByText("الجواب الصحيح:")).toBeInTheDocument();
    expect(screen.getByText("market")).toBeInTheDocument();
  });

  it("says nothing extra when they get it right", () => {
    render({ mode: "typing" });

    typeAndSubmit("market");

    expect(screen.queryByText("الجواب الصحيح:")).not.toBeInTheDocument();
  });

  it("will not submit an empty answer", () => {
    const { onAnswer } = render({ mode: "typing" });

    // Nothing typed is not a wrong answer; scoring it would punish a mis-tap.
    expect(screen.getByRole("button", { name: "تحقّق" })).toBeDisabled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("will not submit whitespace", () => {
    const { onAnswer } = render({ mode: "typing" });

    typeAndSubmit("   ");

    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("locks the field once answered", () => {
    const { onAnswer } = render({ mode: "typing" });

    typeAndSubmit("shop");
    fireEvent.change(screen.getByPlaceholderText("اكتب الكلمة بالإنجليزي…"), {
      target: { value: "market" },
    });

    // The correct answer is on screen by now; letting them retype it would make
    // the score a measure of reading.
    expect(screen.getByPlaceholderText("اكتب الكلمة بالإنجليزي…")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "تحقّق" })).not.toBeInTheDocument();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("offers no options to pick from", () => {
    render({ mode: "typing" });

    // Producing the word is the harder claim, and it is not a claim at all if
    // the answer is visible in a button beside the field.
    expect(optionButtons()).toEqual([]);
  });

  it("starts fresh on the next word", () => {
    const { rerender, onAnswer } = render({ mode: "typing" });
    typeAndSubmit("market");

    rerender(
      <QuizQuestion
        mode="typing"
        currentWord={aWord(9, { word_arabic: "مطعم", word_english: "restaurant" })}
        otherWords={OTHERS}
        gradient="bg-gradient-green"
        onAnswer={onAnswer}
      />,
    );

    // A field still holding the previous answer would submit it for the new
    // word on the first keypress.
    expect(screen.getByPlaceholderText("اكتب الكلمة بالإنجليزي…")).toHaveValue("");
    expect(screen.queryByText("صح! أحسنت")).not.toBeInTheDocument();
  });
});
