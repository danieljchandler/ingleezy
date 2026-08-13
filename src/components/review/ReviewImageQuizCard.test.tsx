import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { VocabularyWord } from "@/hooks/useReview";
import { ReviewImageQuizCard } from "./ReviewImageQuizCard";

/**
 * The listen-and-point card: hear the word, pick the picture.
 *
 * It is the first of the two review quiz modes and the only one that starts
 * from sound, which is why the audio plays itself on mount — a card that waits
 * for a tap before making any noise is a card the learner answers by reading
 * nothing at all. Words with no recorded audio fall back to synthesis, so the
 * deck never serves a silent card it cannot be answered from.
 */

const tts = vi.hoisted(() => ({
  url: null as string | null,
  loading: false,
  asked: [] as Array<{ text: string; skip?: boolean }>,
  regenerate: vi.fn(),
}));
vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean }) => {
    tts.asked.push(options);
    return {
      ttsUrl: options.skip ? null : tts.url,
      isLoading: options.skip ? false : tts.loading,
      regenerate: tts.regenerate,
    };
  },
}));

const audio = vi.hoisted(() => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }));
vi.mock("@/hooks/useAudioPlayer", () => ({ useAudioPlayer: () => audio }));

const aWord = (over: Partial<VocabularyWord> = {}): VocabularyWord => ({
  id: "word-1",
  word_arabic: "تفاحة",
  word_english: "apple",
  image_url: "https://images.test/apple.png",
  audio_url: "https://audio.test/apple.mp3",
  topic_id: "topic-1",
  ...over,
});

const TARGET = aWord();

/** Exactly three, so every one is used and the option set is deterministic. */
const TOPIC_WORDS: VocabularyWord[] = [
  aWord({ id: "w-2", word_arabic: "موزة", word_english: "banana" }),
  aWord({ id: "w-3", word_arabic: "برتقالة", word_english: "orange" }),
  aWord({ id: "w-4", word_arabic: "عنب", word_english: "grapes" }),
];

const OTHER_TOPIC: VocabularyWord[] = [
  aWord({ id: "o-1", word_arabic: "كرسي", word_english: "chair", topic_id: "topic-2" }),
  aWord({ id: "o-2", word_arabic: "طاولة", word_english: "table", topic_id: "topic-2" }),
  aWord({ id: "o-3", word_arabic: "باب", word_english: "door", topic_id: "topic-2" }),
];

let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.url = null;
  tts.loading = false;
  tts.asked = [];
  tts.regenerate.mockReset();
  audio.isPlaying = false;
  audio.play.mockReset();
  audio.stop.mockReset();
});

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  word?: VocabularyWord;
  topicWords?: VocabularyWord[];
  fallbackWords?: VocabularyWord[];
  disabled?: boolean;
}

function render({
  word = TARGET,
  topicWords = TOPIC_WORDS,
  fallbackWords,
  disabled,
}: Options = {}) {
  const onAnswer = vi.fn();
  const harness = renderWithProviders(
    <ReviewImageQuizCard
      word={word}
      topicWords={topicWords}
      fallbackWords={fallbackWords}
      onAnswer={onAnswer}
      disabled={disabled}
    />,
    { persona: "free" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onAnswer };
}

const listen = () => screen.getByRole("button", { name: "Play word audio" });
const pictures = () =>
  screen.getAllByRole("button").filter((b) => b !== listen());
const pictureFor = (english: string) =>
  screen.getByRole("button", { name: english });
const englishOptions = () => pictures().map((b) => b.getAttribute("aria-label"));

describe("the audio", () => {
  it("plays the word as soon as the card appears", () => {
    render();

    // A card that waits for a tap is answered by looking at the pictures, which
    // tests nothing.
    expect(audio.play).toHaveBeenCalledWith("https://audio.test/apple.mp3");
  });

  it("does not ask for synthesis when there is a recording", () => {
    render();

    // A native recording is always better than TTS, and asking anyway costs a
    // metered call per card.
    expect(tts.asked[0]).toMatchObject({ text: "تفاحة", skip: true });
  });

  it("synthesises the word when there is no recording", () => {
    tts.url = "https://tts.test/apple.mp3";
    render({ word: aWord({ audio_url: null }) });

    // Most words in the deck have no recording. Skipping them would make the
    // listening mode unusable for the majority of the curriculum.
    expect(tts.asked[0]).toMatchObject({ text: "تفاحة", skip: false });
    expect(audio.play).toHaveBeenCalledWith("https://tts.test/apple.mp3");
  });

  it("plays as soon as the synthesis arrives", () => {
    const { rerender } = render({ word: aWord({ audio_url: null }) });
    expect(audio.play).not.toHaveBeenCalled();

    tts.url = "https://tts.test/apple.mp3";
    act(() => {
      rerender(
        <ReviewImageQuizCard
          word={aWord({ audio_url: null })}
          topicWords={TOPIC_WORDS}
          onAnswer={vi.fn()}
        />,
      );
    });

    // The card is on screen while the synthesis is still in flight, so the
    // auto-play has to happen on arrival rather than on mount.
    expect(audio.play).toHaveBeenCalledWith("https://tts.test/apple.mp3");
  });

  it("plays itself only once for a card", () => {
    const { rerender } = render();

    act(() => {
      rerender(
        <ReviewImageQuizCard word={TARGET} topicWords={TOPIC_WORDS} onAnswer={vi.fn()} />,
      );
    });

    // Any parent re-render would otherwise restart the audio mid-word.
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("plays itself again for the next card", () => {
    const { rerender } = render();
    audio.play.mockClear();

    act(() => {
      rerender(
        <ReviewImageQuizCard
          word={aWord({ id: "w-9", word_arabic: "موزة", audio_url: "https://audio.test/banana.mp3" })}
          topicWords={TOPIC_WORDS}
          onAnswer={vi.fn()}
        />,
      );
    });

    expect(audio.play).toHaveBeenCalledWith("https://audio.test/banana.mp3");
  });

  it("can be replayed on demand", () => {
    render();
    audio.play.mockClear();

    fireEvent.click(listen());

    // Once through is rarely enough at conversational speed.
    expect(audio.play).toHaveBeenCalledWith("https://audio.test/apple.mp3");
  });

  it("says what it is doing", () => {
    render();
    expect(screen.getByText("Tap to listen again")).toBeInTheDocument();

    audio.isPlaying = true;
    cleanup?.();
    render();

    expect(screen.getByText("Playing…")).toBeInTheDocument();
  });

  it("will not stack a second playback on the first", () => {
    audio.isPlaying = true;
    render();
    audio.play.mockClear();

    fireEvent.click(listen());

    // Two overlapping playbacks of the same word are unintelligible.
    expect(listen()).toBeDisabled();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("waits rather than offering silence while the voice is being made", () => {
    tts.loading = true;
    render({ word: aWord({ audio_url: null }) });

    expect(listen()).toBeDisabled();
    expect(document.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows the button as dead when there is no audio at all", () => {
    render({ word: aWord({ audio_url: null }) });

    // TTS came back with nothing. The card is unanswerable, and saying so beats
    // a button that does nothing when pressed.
    expect(listen()).toBeDisabled();
    expect(listen().className).toContain("opacity-50");
  });
});

describe("the pictures", () => {
  it("asks which one matches", () => {
    render();

    expect(
      screen.getByText("Which picture matches the word you heard?"),
    ).toBeInTheDocument();
  });

  it("offers four, one of them right", () => {
    render();

    expect(pictures()).toHaveLength(4);
    expect(englishOptions()).toContain("apple");
  });

  it("names each picture for a screen reader", () => {
    render();

    // Four unlabelled images are four identical buttons to anyone not looking
    // at the screen.
    expect(englishOptions().every(Boolean)).toBe(true);
  });

  it("draws the wrong answers from the same topic", () => {
    render();

    expect(englishOptions().filter((w) => w !== "apple").sort()).toEqual(
      ["banana", "grapes", "orange"].sort(),
    );
  });

  it("pads from other topics when the topic is too small", () => {
    render({ topicWords: [TOPIC_WORDS[0]], fallbackWords: OTHER_TOPIC });

    expect(pictures()).toHaveLength(4);
  });

  it("never offers the answer twice", () => {
    render({ topicWords: [TARGET, ...TOPIC_WORDS] });

    expect(englishOptions().filter((w) => w === "apple")).toHaveLength(1);
  });

  it("shows a placeholder for a word with no picture", () => {
    render({
      word: TARGET,
      topicWords: [aWord({ id: "w-2", word_english: "banana", image_url: null }), ...TOPIC_WORDS.slice(1)],
    });

    // Words are added before their images are generated, and a broken tile is
    // worse than an obviously empty one.
    expect(pictureFor("banana").querySelector("img")).toBeNull();
    expect(pictureFor("banana").querySelector(".lucide-volume2")).not.toBeNull();
  });

  it("does not rebuild the options when the pool arrives late", () => {
    const { rerender } = render({ topicWords: [] });
    expect(pictures()).toHaveLength(1);

    act(() => {
      rerender(
        <ReviewImageQuizCard word={TARGET} topicWords={TOPIC_WORDS} onAnswer={vi.fn()} />,
      );
    });

    // Pinned, same as its sibling card: the option set is memoised on `word.id`
    // alone, so a card rendered before its distractor pool has loaded stays a
    // one-picture card and answers itself.
    expect(pictures()).toHaveLength(1);
  });
});

describe("answering", () => {
  it("reports a right answer and ticks it", () => {
    const { onAnswer } = render();

    fireEvent.click(pictureFor("apple"));

    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(pictureFor("apple").className).toContain("border-success");
    expect(screen.getByText("Correct! أحسنت")).toBeInTheDocument();
  });

  it("reports a wrong answer and says what the word was", () => {
    const { onAnswer } = render();

    fireEvent.click(pictureFor("banana"));

    // The learner heard a word they could not place; the whole value of the
    // card is being told which one it was.
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(screen.getByText("The word was: تفاحة")).toBeInTheDocument();
  });

  it("marks the right picture too when the learner missed it", () => {
    render();

    fireEvent.click(pictureFor("banana"));

    expect(pictureFor("banana").className).toContain("border-destructive");
    expect(pictureFor("apple").className).toContain("border-success");
  });

  it("takes no second answer", () => {
    const { onAnswer } = render();

    fireEvent.click(pictureFor("banana"));
    fireEvent.click(pictureFor("apple"));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(false);
    for (const picture of pictures()) expect(picture).toBeDisabled();
  });

  it("accepts nothing while the deck is busy", () => {
    const { onAnswer } = render({ disabled: true });

    fireEvent.click(pictureFor("apple"));

    // `disabled` covers the window where the previous answer is being saved; a
    // tap landing in it would answer the next card.
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.queryByText("Correct! أحسنت")).toBeNull();
  });

  it("still lets the word be replayed after answering", () => {
    render();
    fireEvent.click(pictureFor("banana"));
    audio.play.mockClear();

    fireEvent.click(listen());

    // Hearing the word again next to the right picture is where the correction
    // actually lands.
    expect(audio.play).toHaveBeenCalled();
  });
});
