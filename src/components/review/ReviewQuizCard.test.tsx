import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { VocabularyWord } from "@/hooks/useReview";
import { ReviewQuizCard } from "./ReviewQuizCard";

/**
 * The picture-to-word card: see the image, pick the Arabic.
 *
 * This is the production direction of the review deck — the learner has to
 * retrieve the word rather than recognise it, which is what makes a card stick.
 * Two details carry it. The distractors come from the same topic first, because
 * choosing between four words about food is a real test and choosing between a
 * food word and three colours is not. And every option has its own play button,
 * so a learner who is unsure can hear the candidates rather than guess.
 */

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
  audio.isPlaying = false;
  audio.play.mockReset();
  audio.stop.mockReset();
});

afterEach(async () => {
  // The providers the harness wraps around the card resolve a session on a
  // macrotask. Restoring the real fetch before that lands turns it into an
  // unstubbed network request.
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
    <ReviewQuizCard
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

/** The choice tiles, in the order they were shuffled into. */
const options = () =>
  screen.getAllByRole("button").filter((el) => el.tagName === "DIV");

const optionFor = (arabic: string) =>
  options().find((el) => el.textContent?.includes(arabic))!;

const words = () =>
  options().map((el) => el.querySelector('[dir="rtl"]')!.textContent!.trim());

describe("posing the question", () => {
  it("shows the picture and asks for the word", () => {
    const { container } = render();

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://images.test/apple.png",
    );
    expect(screen.getByText("Which word matches the picture?")).toBeInTheDocument();
  });

  it("frames the picture the way the admin cropped it", () => {
    const { container } = render({
      word: aWord({ image_position: "30 70" }),
    });

    // Stock photography is rarely centred on the object being taught; the
    // admin's crop is the difference between a picture of an apple and a picture
    // of a table with an apple on it.
    expect(container.querySelector("img")!.style.objectPosition).toBe("30% 70%");
  });

  it("centres a picture with no crop recorded", () => {
    const { container } = render();

    expect(container.querySelector("img")!.style.objectPosition).toBe("50% 50%");
  });

  it("shows a placeholder when the word has no picture", () => {
    const { container } = render({ word: aWord({ image_url: null }) });

    // Without this the card is a blank box above four words, and there is
    // nothing to match against.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".lucide-volume2")).not.toBeNull();
  });

  it("offers four words, one of them right", () => {
    render();

    expect(options()).toHaveLength(4);
    expect(words()).toContain("تفاحة");
  });

  it("draws the wrong answers from the same topic", () => {
    render();

    // Four fruit is a vocabulary test. One fruit and three pieces of furniture
    // is a test of nothing.
    expect(words().filter((w) => w !== "تفاحة").sort()).toEqual(
      ["برتقالة", "عنب", "موزة"].sort(),
    );
  });

  it("never offers the answer twice", () => {
    render({ topicWords: [TARGET, ...TOPIC_WORDS] });

    // The pool includes the word under test — a duplicate would make two tiles
    // correct and the feedback nonsensical.
    expect(words().filter((w) => w === "تفاحة")).toHaveLength(1);
  });

  it("pads from other topics when the topic is too small", () => {
    render({ topicWords: [TOPIC_WORDS[0]], fallbackWords: OTHER_TOPIC });

    // A two-option card is a coin toss, and early topics routinely have only a
    // handful of words in them.
    expect(options()).toHaveLength(4);
    expect(words()).toContain("موزة");
  });

  it("prefers the topic's own words over the fallback pool", () => {
    render({ topicWords: TOPIC_WORDS, fallbackWords: OTHER_TOPIC });

    expect(words()).not.toContain("كرسي");
  });

  it("offers what it has when there is nothing to pad with", () => {
    render({ topicWords: [] });

    // Better a one-option card than a crash mid-review.
    expect(options()).toHaveLength(1);
    expect(words()).toEqual(["تفاحة"]);
  });

  it("does not rebuild the options when the pool arrives late", () => {
    const { rerender } = render({ topicWords: [] });
    expect(options()).toHaveLength(1);

    rerender(
      <ReviewQuizCard
        word={TARGET}
        topicWords={TOPIC_WORDS}
        onAnswer={vi.fn()}
      />,
    );

    // Pinned: the option set is memoised on `word.id` alone. A card rendered
    // before its distractor pool has loaded — the ordinary case, since the pool
    // is a separate query — stays a single-option card for as long as it is on
    // screen, and answering it is automatic.
    expect(options()).toHaveLength(1);
  });

  it("reshuffles for the next word", () => {
    const { rerender } = render();

    rerender(
      <ReviewQuizCard
        word={TOPIC_WORDS[0]}
        topicWords={[TARGET, ...TOPIC_WORDS.slice(1)]}
        onAnswer={vi.fn()}
      />,
    );

    expect(words()).toContain("موزة");
    expect(options()).toHaveLength(4);
  });
});

describe("answering", () => {
  it("reports a right answer and marks it", () => {
    const { onAnswer } = render();

    fireEvent.click(optionFor("تفاحة"));

    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(optionFor("تفاحة").className).toContain("border-success");
    expect(screen.getByText("Correct! أحسنت")).toBeInTheDocument();
  });

  it("reports a wrong answer and says what it was", () => {
    const { onAnswer } = render();

    fireEvent.click(optionFor("موزة"));

    // Being told you were wrong without being told the answer leaves the card
    // no more learnable than before.
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(screen.getByText("The answer was: تفاحة")).toBeInTheDocument();
  });

  it("marks the right one too when the learner missed it", () => {
    render();

    fireEvent.click(optionFor("موزة"));

    expect(optionFor("موزة").className).toContain("border-destructive");
    expect(optionFor("تفاحة").className).toContain("border-success");
  });

  it("takes no second answer", () => {
    const { onAnswer } = render();

    fireEvent.click(optionFor("موزة"));
    fireEvent.click(optionFor("تفاحة"));

    // Otherwise the learner taps until the green one appears and the card is
    // scheduled as if they knew it.
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("takes the tiles out of the tab order once answered", () => {
    render();

    fireEvent.click(optionFor("تفاحة"));

    for (const option of options()) {
      expect(option).toHaveAttribute("tabindex", "-1");
      expect(option).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("can be answered from the keyboard", () => {
    const { onAnswer } = render();

    fireEvent.keyDown(optionFor("تفاحة"), { key: "Enter" });

    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("ignores every other key", () => {
    const { onAnswer } = render();

    fireEvent.keyDown(optionFor("تفاحة"), { key: "a" });

    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("accepts nothing while the deck is busy", () => {
    const { onAnswer } = render({ disabled: true });

    fireEvent.click(optionFor("تفاحة"));

    // `disabled` is set while the previous answer is being saved. A tap that
    // lands in that window would answer the *next* card.
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.queryByText("Correct! أحسنت")).toBeNull();
  });
});

describe("hearing the options", () => {
  it("plays the option that was tapped", () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: "Play موزة" }));

    expect(audio.play).toHaveBeenCalledWith("https://audio.test/apple.mp3");
  });

  it("does not count listening as answering", () => {
    const { onAnswer } = render();

    fireEvent.click(screen.getByRole("button", { name: "Play موزة" }));

    // The play button sits inside the tile. Without stopping the bubble, a
    // learner checking their guess would submit it.
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.queryByText(/Correct|The answer was/)).toBeNull();
  });

  it("offers no audio for a word that has none", () => {
    render({
      word: TARGET,
      topicWords: [
        aWord({ id: "w-2", word_arabic: "موزة", word_english: "banana", audio_url: null }),
        ...TOPIC_WORDS.slice(1),
      ],
    });

    expect(screen.getByRole("button", { name: "Play موزة" })).toBeDisabled();
  });

  it("can still be listened to after the card is answered", () => {
    render();
    fireEvent.click(optionFor("موزة"));

    fireEvent.click(screen.getByRole("button", { name: "Play تفاحة" }));

    // Hearing the answer you got wrong is the most useful moment on this card.
    expect(audio.play).toHaveBeenCalled();
  });
});
