import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { QuizCard } from "./QuizCard";

/**
 * The multiple-choice half of a lesson: an Arabic word, four English options.
 *
 * It is the cheapest possible check that a word went in, and its job is to be
 * fast — a learner gets through twenty of these in a couple of minutes. Almost
 * every decision here follows from that: the audio plays itself, a correct
 * answer moves on without a tap, and the options are drawn from the same topic
 * so that the wrong ones are plausible rather than absurd.
 *
 * The asymmetry between right and wrong is the deliberate part. Correct answers
 * advance after a beat; a wrong one waits for the learner to press Continue, so
 * that the sentence telling them what the word actually means does not flash
 * past while they are already reaching for the next card.
 */

const tts = vi.hoisted(() => ({ ttsUrl: null as string | null, isLoading: false }));
const audio = vi.hoisted(() => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }));
const ttsOptions = vi.hoisted(() => ({ last: null as unknown }));

vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: unknown) => {
    ttsOptions.last = options;
    return { ...tts, regenerate: vi.fn() };
  },
}));

vi.mock("@/hooks/useAudioPlayer", () => ({
  useAudioPlayer: () => audio,
}));

const aWord = (over: Partial<Parameters<typeof QuizCard>[0]["word"]> = {}) => ({
  id: "w-1",
  word_arabic: "سوق",
  word_english: "market",
  image_url: null,
  audio_url: "https://audio.test/souq.mp3",
  ...over,
});

// Exactly three, so that every distractor is used and the four options a test
// sees are the four the fixture named. The card picks three at random from
// whatever it is given.
const OTHERS = [
  { id: "w-2", word_arabic: "بيت", word_english: "house", image_url: null, audio_url: null },
  { id: "w-3", word_arabic: "مدرسة", word_english: "school", image_url: null, audio_url: null },
  { id: "w-4", word_arabic: "مطعم", word_english: "restaurant", image_url: null, audio_url: null },
];

const A_WHOLE_TOPIC = [
  ...OTHERS,
  { id: "w-5", word_arabic: "سيارة", word_english: "car", image_url: null, audio_url: null },
  { id: "w-6", word_arabic: "شارع", word_english: "street", image_url: null, audio_url: null },
];

let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.ttsUrl = null;
  tts.isLoading = false;
  audio.isPlaying = false;
  audio.play.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

type Word = ReturnType<typeof aWord>;

function render({
  word = aWord(),
  otherWords = OTHERS,
  topicLabel,
}: { word?: Word; otherWords?: Word[]; topicLabel?: string } = {}) {
  const onAnswer = vi.fn();
  const harness = renderWithProviders(
    <QuizCard word={word} otherWords={otherWords} onAnswer={onAnswer} topicLabel={topicLabel} />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onAnswer };
}

const choose = (option: string) =>
  fireEvent.click(screen.getByRole("radio", { name: option }));

describe("asking the question", () => {
  it("shows the Arabic word and what is being asked", () => {
    render();

    expect(screen.getByText("سوق")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("وش معناها بالإنجليزي؟")).toBeInTheDocument();
  });

  it("names the topic the word came from", () => {
    render({ topicLabel: "Around town" });

    // A word met inside a topic is easier to place than one met alone.
    expect(screen.getByText("Around town")).toBeInTheDocument();
  });

  it("shows the reading when the word has one", () => {
    render({ word: aWord({ transliteration: "souq" }) });

    expect(screen.getByText("souq")).toBeInTheDocument();
  });

  it("offers four options with the right answer among them", () => {
    render({ otherWords: A_WHOLE_TOPIC });

    const options = screen.getAllByRole("radio").map((b) => b.getAttribute("aria-label"));
    expect(options).toHaveLength(4);
    expect(options).toContain("market");
  });

  it("draws the wrong answers from the words around it", () => {
    render({ otherWords: A_WHOLE_TOPIC });

    // Distractors from the same topic are the whole test. "market" against
    // three nonsense words is a reading exercise, not a vocabulary one.
    const options = screen.getAllByRole("radio").map((b) => b.getAttribute("aria-label"));
    for (const option of options) {
      expect(["market", ...A_WHOLE_TOPIC.map((w) => w.word_english)]).toContain(option);
    }
  });

  it("offers what it has when there are not enough other words", () => {
    render({ otherWords: [OTHERS[0]] });

    // Early in a topic there may be only one other word; a card that refuses to
    // render would block the lesson.
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("never offers the word itself as a wrong answer", () => {
    render({ otherWords: [...OTHERS, aWord()] });

    const options = screen.getAllByRole("radio").map((b) => b.getAttribute("aria-label"));
    expect(options.filter((o) => o === "market")).toHaveLength(1);
  });

  it("accepts either of two options that mean the same thing", () => {
    const { onAnswer } = render({
      otherWords: [
        { id: "w-9", word_arabic: "سوگ", word_english: "market", image_url: null, audio_url: null },
        OTHERS[0],
      ],
    });

    const duplicates = screen.getAllByRole("radio", { name: "market" });
    fireEvent.click(duplicates[1]);

    // Pinned: two curriculum words with the same English produce two identical
    // options, both marked correct. It is the lenient outcome rather than the
    // wrong one, but the card asks a question with two right answers.
    expect(duplicates).toHaveLength(2);
    expect(screen.getByText(/Correct!/)).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe("hearing the word", () => {
  it("plays the recording by itself shortly after the card appears", () => {
    vi.useFakeTimers();
    render();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Hearing it is half of learning it, and a learner working through twenty
    // cards will not press play twenty times.
    expect(audio.play).toHaveBeenCalledWith("https://audio.test/souq.mp3");
  });

  it("plays it again on request", () => {
    render();
    audio.play.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "شغّل النطق" }));

    expect(audio.play).toHaveBeenCalledWith("https://audio.test/souq.mp3");
  });

  it("asks for speech only when the word has no recording", () => {
    render();

    // Generating audio for a word that already has a recording would cost money
    // and sound worse than the native one.
    expect(ttsOptions.last).toMatchObject({ text: "سوق", skip: true });
  });

  it("generates speech for a word with no recording", () => {
    render({ word: aWord({ audio_url: null }) });

    expect(ttsOptions.last).toMatchObject({ text: "سوق", skip: false });
  });

  it("says it is working while the speech is generated", () => {
    tts.isLoading = true;
    render({ word: aWord({ audio_url: null }) });

    expect(screen.getByRole("button", { name: "شغّل النطق" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("plays the generated speech as soon as it arrives", async () => {
    const { rerender } = render({ word: aWord({ audio_url: null }) });
    expect(audio.play).not.toHaveBeenCalled();

    tts.ttsUrl = "blob:generated";
    rerender(
      <QuizCard
        word={aWord({ audio_url: null })}
        otherWords={OTHERS}
        onAnswer={vi.fn()}
      />,
    );

    await waitFor(() => expect(audio.play).toHaveBeenCalledWith("blob:generated"));
  });

  it("leaves the play button dead when there is nothing to play", () => {
    render({ word: aWord({ audio_url: null }) });

    expect(screen.getByRole("button", { name: "شغّل النطق" })).toBeDisabled();
  });
});

describe("answering", () => {
  it("says so and moves on after a beat when the answer is right", () => {
    vi.useFakeTimers();
    const { onAnswer } = render();

    choose("market");

    expect(screen.getByText("Correct! أحسنت")).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // Long enough to register, short enough that twenty cards stay quick.
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("waits for the learner when the answer is wrong", () => {
    vi.useFakeTimers();
    const { onAnswer } = render();

    choose("house");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // The correction is the only teaching this card does; letting it flash past
    // would waste the one moment the learner is paying attention.
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("says what the word actually meant", () => {
    render();

    choose("house");

    expect(
      screen.getByText('Not quite — "سوق" means "market", not "house"'),
    ).toBeInTheDocument();
  });

  it("reports the miss when the learner acknowledges it", () => {
    const { onAnswer } = render();
    choose("house");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("marks the right answer as well as the wrong one", () => {
    render();

    choose("house");

    // Being told you were wrong without being shown the answer teaches nothing.
    expect(screen.getByRole("radio", { name: "market" }).className).toContain("border-success");
    expect(screen.getByRole("radio", { name: "house" }).className).toContain(
      "border-destructive",
    );
  });

  it("stops taking answers once one is given", () => {
    vi.useFakeTimers();
    const { onAnswer } = render();

    choose("house");
    choose("market");

    // Otherwise a learner taps until the green one appears and the score
    // measures nothing.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onAnswer).not.toHaveBeenCalled();
    for (const option of screen.getAllByRole("radio")) {
      expect(option).toBeDisabled();
    }
  });

  it("advances once when the same answer is tapped twice", () => {
    vi.useFakeTimers();
    const { onAnswer } = render();

    choose("market");
    choose("market");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // A double tap on a slow phone would otherwise skip the card after it.
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
