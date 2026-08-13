import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ReviewClozeCard } from "./ReviewClozeCard";

/**
 * The cloze card in the review deck: the learner's own sentence with the word
 * taken out of it.
 *
 * A flashcard asks whether a word can be recognised. This asks whether it can
 * be placed — which is nearly the whole of using a word, and is the reason the
 * distractors are other words from the same due queue rather than random ones.
 *
 * The audio is the subtle part. The recorded sentence contains the word, so
 * playing it would read the answer out loud. Before the learner answers, the
 * card synthesises a version with the word replaced by a pause; afterwards it
 * plays the real sentence so the word is heard where it belongs.
 */

const tts = vi.hoisted(() => ({
  urls: {} as Record<string, string>,
  loading: {} as Record<string, boolean>,
  asked: [] as Array<{ text: string; skip?: boolean }>,
}));

vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean; dialect?: string }) => {
    tts.asked.push(options);
    return {
      ttsUrl: options.skip ? null : (tts.urls[options.text] ?? null),
      isLoading: options.skip ? false : (tts.loading[options.text] ?? false),
      regenerate: vi.fn(),
    };
  },
}));

const SENTENCE = "رحت السوق أمس";
const WORD = "السوق";
const MASKED = "رحت ... أمس";
const DISTRACTORS = ["بيت", "مدرسة", "مطعم"];

const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
let audios: HTMLAudioElement[] = [];
let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.urls = {};
  tts.loading = {};
  tts.asked = [];
  audios = [];
  play.mockClear();
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

type Props = Partial<Parameters<typeof ReviewClozeCard>[0]>;

function render(over: Props = {}) {
  const onAnswered = vi.fn();
  const harness = renderWithProviders(
    <ReviewClozeCard
      wordArabic={WORD}
      wordEnglish="the market"
      sentenceText={SENTENCE}
      distractors={DISTRACTORS}
      onAnswered={onAnswered}
      {...over}
    />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onAnswered };
}

const choices = () =>
  screen.getAllByRole("button").filter((b) => b.getAttribute("dir") === "rtl");
const choose = (word: string) =>
  fireEvent.click(choices().find((b) => b.textContent?.trim() === word)!);
const audioButton = () => screen.getByRole("button", { name: /play .* sentence|play sentence/i });
const askedFor = (text: string) => tts.asked.filter((a) => a.text === text);

describe("posing the question", () => {
  it("takes the word out of the sentence and leaves the rest", () => {
    render();

    // The surrounding words are the clue. Blanking more than the target would
    // turn a placement exercise into a guess.
    expect(screen.getByText("رحت")).toBeInTheDocument();
    expect(screen.getByText("أمس")).toBeInTheDocument();
    expect(screen.getByText("ـــ")).toBeInTheDocument();
    expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
  });

  it("declines the card when the word is not in the sentence", () => {
    const { container } = render({ sentenceText: "رحت المطعم أمس" });

    // The caller falls back to an ordinary flashcard; a blank that never
    // appeared would be an unanswerable question.
    expect(container).toBeEmptyDOMElement();
  });

  it("does not blank a word that is only part of a longer one", () => {
    const { container } = render({ wordArabic: "سوق", sentenceText: SENTENCE });

    // "سوق" inside "السوق" is the same root, not the same word, and blanking
    // half a word leaves nonsense on screen.
    expect(container).toBeEmptyDOMElement();
  });

  it("finds a word that ends the sentence at a full stop", () => {
    render({ sentenceText: "رحت السوق." });

    expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
  });
});

describe("the options", () => {
  it("offers the answer among words from the same deck", () => {
    render();

    // Distractors drawn from the learner's own due queue are words they are
    // meant to be able to tell apart; random Arabic would be a reading test.
    const labels = choices().map((b) => b.textContent?.trim());
    expect(labels).toHaveLength(4);
    expect(labels).toContain(WORD);
    for (const label of labels) expect([WORD, ...DISTRACTORS]).toContain(label);
  });

  it("never offers the answer twice", () => {
    render({ distractors: [WORD, ...DISTRACTORS] });

    expect(choices().filter((b) => b.textContent?.trim() === WORD)).toHaveLength(1);
  });

  it("throws away distractors that are not Arabic", () => {
    render({ distractors: ["house", "school", "بيت"] });

    // The due queue holds both halves of a card, so an English gloss can reach
    // the distractor list; offered as an answer it is obviously wrong and the
    // question stops testing anything.
    const labels = choices().map((b) => b.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining([WORD, "بيت"]));
    expect(labels).toHaveLength(2);
  });

  it("asks with what it has when the deck is nearly empty", () => {
    render({ distractors: [] });

    // Early in a deck there is nothing to choose between; a card that refused
    // to render would stall the review.
    expect(choices()).toHaveLength(1);
  });
});

describe("the audio", () => {
  it("plays the sentence with the word muted before the answer", () => {
    tts.urls[MASKED] = "blob:masked";
    render();

    // Playing the recording here would read the answer out loud.
    expect(askedFor(MASKED)[0]).toMatchObject({ skip: false });
    expect(audios[0].src).toContain("blob:masked");
    expect(screen.getByText("Word muted")).toBeInTheDocument();
  });

  it("does not ask for the full sentence until it has been answered", () => {
    render({ sentenceAudioUrl: null });

    expect(askedFor(SENTENCE).every((ask) => ask.skip)).toBe(true);
  });

  it("plays the real recording once the answer is in", () => {
    tts.urls[MASKED] = "blob:masked";
    render({ sentenceAudioUrl: "https://audio.test/sentence.mp3" });

    choose(WORD);

    // Hearing the word in the sentence, said by a person, is the point of
    // having the sentence at all.
    expect(audios.at(-1)!.src).toBe("https://audio.test/sentence.mp3");
    expect(screen.getByText("Full sentence")).toBeInTheDocument();
  });

  it("falls back to speech when the sentence was never recorded", () => {
    tts.urls[MASKED] = "blob:masked";
    tts.urls[SENTENCE] = "blob:full";
    render({ sentenceAudioUrl: null });

    choose(WORD);

    expect(audios.at(-1)!.src).toContain("blob:full");
  });

  it("replays on request", () => {
    tts.urls[MASKED] = "blob:masked";
    render();
    play.mockClear();

    fireEvent.click(audioButton());

    expect(play).toHaveBeenCalled();
  });

  it("offers nothing to press while the speech is being made", () => {
    tts.loading[MASKED] = true;
    render();

    expect(audioButton()).toBeDisabled();
  });
});

describe("answering", () => {
  it("puts the chosen word into the blank", () => {
    const { container } = render();

    choose("بيت");

    // Seeing the wrong word in the sentence is what makes it wrong — the
    // learner reads back something that does not mean anything.
    const blank = container.querySelector("span.border-dashed, span.border-solid")!;
    expect(blank.textContent).toBe("بيت");
    expect(blank.className).toContain("border-red");
  });

  it("reports a right answer", () => {
    const { onAnswered } = render();

    choose(WORD);

    expect(onAnswered).toHaveBeenCalledWith(true);
  });

  it("reports a wrong one", () => {
    const { onAnswered } = render();

    choose("بيت");

    expect(onAnswered).toHaveBeenCalledWith(false);
  });

  it("marks the answer even when the learner missed it", () => {
    render();

    choose("بيت");

    // Being told you were wrong without being shown the answer teaches nothing.
    const target = choices().find((b) => b.textContent?.trim() === WORD)!;
    expect(target.className).toContain("border-green");
  });

  it("stops taking answers once one is given", () => {
    const { onAnswered } = render();

    choose("بيت");
    choose(WORD);

    // Otherwise the learner taps until the green one appears and the review
    // schedule is built on a lie.
    expect(onAnswered).toHaveBeenCalledTimes(1);
    for (const option of choices()) expect(option).toBeDisabled();
  });

  it("gives the word and its meaning afterwards", () => {
    render();

    choose(WORD);

    expect(screen.getByText("— the market")).toBeInTheDocument();
  });
});

describe("the sentence translation", () => {
  it("stays behind a tap", () => {
    render({ sentenceEnglish: "I went to the market yesterday" });
    choose(WORD);

    // Working the sentence out from the Arabic is the exercise; the English is
    // the check on it.
    expect(screen.queryByText("I went to the market yesterday")).toBeNull();
    expect(screen.getByRole("button", { name: /show translation/i })).toBeInTheDocument();
  });

  it("appears when the learner asks", () => {
    render({ sentenceEnglish: "I went to the market yesterday" });
    choose(WORD);

    fireEvent.click(screen.getByRole("button", { name: /show translation/i }));

    expect(screen.getByText("I went to the market yesterday")).toBeInTheDocument();
  });

  it("is not offered before the answer", () => {
    render({ sentenceEnglish: "I went to the market yesterday" });

    expect(screen.queryByRole("button", { name: /show translation/i })).toBeNull();
  });

  it("says nothing when the sentence has no translation", () => {
    render();
    choose(WORD);

    expect(screen.queryByRole("button", { name: /show translation/i })).toBeNull();
  });
});

describe("moving to the next card", () => {
  it("clears the answer and the translation", () => {
    const { rerender } = render({ sentenceEnglish: "I went to the market yesterday" });
    choose(WORD);
    fireEvent.click(screen.getByRole("button", { name: /show translation/i }));

    act(() => {
      rerender(
        <ReviewClozeCard
          wordArabic="البيت"
          wordEnglish="the house"
          sentenceText="البيت كبير"
          sentenceEnglish="The house is big"
          distractors={DISTRACTORS}
        />,
      );
    });

    // A card arriving already answered would skip the exercise, and the
    // previous sentence's English under a new sentence is simply wrong.
    expect(screen.getByText("Word muted")).toBeInTheDocument();
    expect(screen.queryByText("I went to the market yesterday")).toBeNull();
    expect(choices()[0]).toBeEnabled();
  });
});
