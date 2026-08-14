import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { VocabularyCard, type VocabularyWord } from "./VocabularyCard";

/**
 * The vocabulary card every part of the app shows a word through — flashcards,
 * review, the intro screens, the picture half of a quiz.
 *
 * The picture and the audio carry the meaning, and the English is only there
 * once the learner has had a go. That ordering is the point: the card asks the
 * learner to produce the Arabic from a picture and a sound, and the script
 * stays hidden behind a tap so that recognising it cannot be mistaken for
 * recalling it.
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

vi.mock("@/hooks/useAudioPlayer", () => ({ useAudioPlayer: () => audio }));

const aWord = (over: Partial<VocabularyWord> = {}): VocabularyWord => ({
  id: "w-1",
  word_arabic: "سوق",
  word_english: "market",
  image_url: "https://images.test/souq.png",
  audio_url: "https://audio.test/souq.mp3",
  ...over,
});

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
});

type Props = Partial<Parameters<typeof VocabularyCard>[0]>;

function render({ word = aWord(), ...rest }: Props = {}) {
  const onCardClick = vi.fn();
  const harness = renderWithProviders(
    <VocabularyCard word={word} onCardClick={onCardClick} {...rest} />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onCardClick };
}

const cardButton = (container: HTMLElement) => container.querySelector("button")!;

describe("showing the word", () => {
  it("shows the picture with nothing else to go on", () => {
    render();

    // The picture is the prompt. A card that also printed the English would be
    // asking nothing.
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://images.test/souq.png");
    expect(screen.queryByText("market")).not.toBeInTheDocument();
    expect(screen.queryByText("سوق")).not.toBeInTheDocument();
  });

  it("leaves the picture out of the description", () => {
    render();

    // The alt text is deliberately empty: naming the picture would give the
    // answer away to a screen reader before the learner has answered.
    expect(screen.getByRole("img")).toHaveAttribute("alt", "");
  });

  it("honours the crop the admin chose", () => {
    render({ word: aWord({ image_position: "30 70" }) });

    // Illustrations are generated at a fixed aspect and the subject is often
    // off-centre; the stored position is what keeps it in frame.
    expect(screen.getByRole("img")).toHaveStyle({ objectPosition: "30% 70%" });
  });

  it("centres a picture with no stored crop", () => {
    render();

    expect(screen.getByRole("img")).toHaveStyle({ objectPosition: "50% 50%" });
  });

  it("falls back to a speaker for a word with no picture", () => {
    const { container } = render({ word: aWord({ image_url: null }) });

    // Not every word illustrates. An empty frame would read as a broken image.
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".lucide-volume2")).not.toBeNull();
  });

  it("invites the tap when the screen wants one", () => {
    render({ showTapHint: true });

    expect(screen.getByText("اضغط تسمعها")).toBeInTheDocument();
  });

  it("uses whatever prompt the screen supplies", () => {
    render({ showTapHint: true, hintText: "Tap for the word" });

    expect(screen.getByText("Tap for the word")).toBeInTheDocument();
  });

  it("drops the hint once the audio is playing", () => {
    audio.isPlaying = true;
    render({ showTapHint: true });

    expect(screen.queryByText("اضغط تسمعها")).toBeNull();
  });
});

describe("hearing the word", () => {
  it("plays the recording when the card is tapped", () => {
    const { container } = render();

    fireEvent.click(cardButton(container));

    expect(audio.play).toHaveBeenCalledWith("https://audio.test/souq.mp3");
  });

  it("tells the screen the card was tapped", () => {
    const { container, onCardClick } = render();

    fireEvent.click(cardButton(container));

    // Flashcard screens advance on the tap; the audio is a side effect of it.
    expect(onCardClick).toHaveBeenCalled();
  });

  it("asks for speech only when the word has no recording", () => {
    render();

    expect(ttsOptions.last).toMatchObject({ text: "سوق", skip: true });
  });

  it("uses generated speech for a word with no recording", () => {
    tts.ttsUrl = "blob:generated";
    const { container } = render({ word: aWord({ audio_url: null }) });

    fireEvent.click(cardButton(container));

    expect(audio.play).toHaveBeenCalledWith("blob:generated");
  });

  it("stays quiet rather than failing when there is nothing to play", () => {
    const { container, onCardClick } = render({ word: aWord({ audio_url: null }) });

    fireEvent.click(cardButton(container));

    // The tap still counts — a card that cannot be advanced because its audio
    // failed to generate would strand the learner.
    expect(audio.play).not.toHaveBeenCalled();
    expect(onCardClick).toHaveBeenCalled();
  });

  it("says it is working while the speech is generated", () => {
    tts.isLoading = true;
    const { container } = render({ word: aWord({ audio_url: null }) });

    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows it is playing", () => {
    audio.isPlaying = true;
    const { container } = render();

    expect(container.querySelector(".animate-pulse-glow")).not.toBeNull();
  });

  it("offers a repeat button to screens that want one", () => {
    const { container } = render({ showRepeatButton: true });
    const repeat = container.querySelector(".lucide-rotate-ccw")!.closest("button")!;

    fireEvent.click(repeat);

    // Hearing it twice is the commonest thing a learner wants, and reaching for
    // the card itself would advance the screen underneath.
    expect(audio.play).toHaveBeenCalledWith("https://audio.test/souq.mp3");
    expect(cardButton(container)).not.toBe(repeat);
  });
});

describe("revealing the answer", () => {
  it("gives the English and holds back the Arabic", () => {
    render({ showAnswer: true });

    // Recognising Arabic script is not the same skill as producing the word,
    // and showing it immediately would only ever test the first.
    expect(screen.getByText("market")).toBeInTheDocument();
    expect(screen.queryByText("سوق")).toBeNull();
    expect(screen.getByText(/جرّب تقول معناها، بعدين اكشفها/)).toBeInTheDocument();
  });

  it("shows the script when the learner asks", () => {
    render({ showAnswer: true });

    fireEvent.click(screen.getByRole("button", { name: /ورّني العربي/ }));

    expect(screen.getByText("سوق")).toHaveAttribute("dir", "rtl");
  });

  it("plays the word as it reveals it", () => {
    render({ showAnswer: true, word: aWord() });
    audio.play.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /ورّني العربي/ }));

    // Seeing the script and hearing it together is what attaches one to the
    // other.
    expect(audio.play).toHaveBeenCalledWith("https://audio.test/souq.mp3");
  });

  it("shows the reading alongside the script", () => {
    render({ showAnswer: true, word: aWord({ transliteration: "souq" }) });

    fireEvent.click(screen.getByRole("button", { name: /ورّني العربي/ }));

    expect(screen.getByText("souq")).toBeInTheDocument();
  });

  it("hides it again without replaying", () => {
    render({ showAnswer: true });
    fireEvent.click(screen.getByRole("button", { name: /ورّني العربي/ }));
    audio.play.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /أخفِ العربي/ }));

    expect(screen.queryByText("سوق")).toBeNull();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("hides the script again for the next word", () => {
    const { rerender } = render({ showAnswer: true });
    fireEvent.click(screen.getByRole("button", { name: /ورّني العربي/ }));

    rerender(
      <VocabularyCard
        word={aWord({ id: "w-2", word_arabic: "بيت", word_english: "house" })}
        showAnswer
      />,
    );

    // A new word arriving already revealed would skip the exercise entirely.
    expect(screen.queryByText("بيت")).toBeNull();
    expect(screen.getByRole("button", { name: /ورّني العربي/ })).toBeInTheDocument();
  });
});
