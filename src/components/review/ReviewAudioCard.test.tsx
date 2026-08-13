import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ReviewAudioCard } from "./ReviewAudioCard";

/**
 * The listening-recall card: hear the word, say what it means.
 *
 * Every other deck in the app shows a written word and asks for the meaning,
 * which tests reading. This is the direction that was missing, and it is the
 * one that matters for a spoken-dialect app — recognising سوق on a page says
 * nothing about catching it at conversational speed.
 *
 * So the Arabic is hidden until the learner reveals it, the audio plays itself
 * as soon as it exists (a silent card is unanswerable), and the voice follows
 * the *word's* dialect rather than the one the learner happens to be studying,
 * because the Mix All queue serves cards from all three at once.
 */

const tts = vi.hoisted(() => ({
  urls: {} as Record<string, string>,
  loading: false,
  asked: [] as Array<{ text: string; skip?: boolean; dialect?: string; persist?: unknown }>,
  regenerate: vi.fn(),
}));

vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: {
    text: string;
    skip?: boolean;
    dialect?: string;
    persist?: unknown;
  }) => {
    tts.asked.push(options);
    return {
      ttsUrl: options.skip ? null : (tts.urls[options.text] ?? null),
      isLoading: options.skip ? false : tts.loading,
      regenerate: tts.regenerate,
    };
  },
}));

const audio = vi.hoisted(() => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }));
vi.mock("@/hooks/useAudioPlayer", () => ({ useAudioPlayer: () => audio }));

const WORD = "سوق";
const RECORDING = "https://audio.test/souq.mp3";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.urls = {};
  tts.loading = false;
  tts.asked = [];
  tts.regenerate.mockReset();
  audio.isPlaying = false;
  audio.play.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

type Props = Partial<Parameters<typeof ReviewAudioCard>[0]>;

/**
 * The learner is always studying Gulf here. The `dialect` prop is the *word's*
 * dialect, which is the whole point of that prop — so it is passed through
 * rather than consumed.
 */
function render(over: Props = {}) {
  localStorage.setItem("ingleezy_dialect_module", "Gulf");
  const onReveal = vi.fn();
  const harness = renderWithProviders(
    <ReviewAudioCard
      wordArabic={WORD}
      wordEnglish="market"
      showAnswer={false}
      onReveal={onReveal}
      {...over}
    />,
    { persona: "free" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onReveal };
}

const speaker = () => screen.getByRole("button", { name: /play the word again/i });

describe("posing the question", () => {
  it("says what kind of card this is", () => {
    render();

    expect(screen.getByText("Listen")).toBeInTheDocument();
  });

  it("keeps the Arabic hidden so the audio is the only way through", () => {
    render();

    // A written word on screen turns a listening card into a reading card.
    expect(screen.queryByText(WORD)).toBeNull();
    expect(screen.queryByText("market")).toBeNull();
    expect(screen.getByRole("button", { name: /reveal/i })).toBeInTheDocument();
  });

  it("shows both halves once the learner reveals", () => {
    render({ showAnswer: true });

    expect(screen.getByText(WORD)).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("market")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reveal/i })).toBeNull();
  });

  it("asks the page to reveal rather than deciding itself", () => {
    const { onReveal } = render();

    fireEvent.click(screen.getByRole("button", { name: /reveal/i }));

    // The review page gates rating on having revealed, so it owns the state.
    expect(onReveal).toHaveBeenCalled();
  });
});

describe("the audio", () => {
  it("plays itself as soon as there is something to hear", () => {
    render({ audioUrl: RECORDING });

    // A card the learner has to press play on before it asks anything is a card
    // that reads as broken.
    expect(audio.play).toHaveBeenCalledWith(RECORDING);
    expect(screen.getByText("What does it mean?")).toBeInTheDocument();
  });

  it("plays again on request", () => {
    render({ audioUrl: RECORDING });
    audio.play.mockClear();

    fireEvent.click(speaker());

    // Hearing it twice is the commonest thing a learner wants on this card.
    expect(audio.play).toHaveBeenCalledWith(RECORDING);
  });

  it("does not replay when the card merely re-renders", () => {
    const { rerender } = render({ audioUrl: RECORDING });
    expect(audio.play).toHaveBeenCalledTimes(1);

    rerender(
      <ReviewAudioCard
        wordArabic={WORD}
        wordEnglish="market"
        audioUrl={RECORDING}
        showAnswer
        onReveal={vi.fn()}
      />,
    );

    // Revealing re-renders the card. Restarting the audio mid-listen because of
    // that would be maddening.
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("plays again for the next word", () => {
    const { rerender } = render({ audioUrl: RECORDING });

    rerender(
      <ReviewAudioCard
        wordArabic="بيت"
        wordEnglish="house"
        audioUrl="https://audio.test/bayt.mp3"
        showAnswer={false}
        onReveal={vi.fn()}
      />,
    );

    expect(audio.play).toHaveBeenCalledWith("https://audio.test/bayt.mp3");
  });

  it("plays again for the same word in another dialect", () => {
    const { rerender } = render({ audioUrl: RECORDING, dialect: "Gulf" });
    audio.play.mockClear();

    rerender(
      <ReviewAudioCard
        wordArabic={WORD}
        wordEnglish="market"
        audioUrl="https://audio.test/souq-eg.mp3"
        dialect="Egyptian"
        showAnswer={false}
        onReveal={vi.fn()}
      />,
    );

    // Mix All serves the same Arabic from several dialects. Keyed on the word
    // alone, the second card would sit silent.
    expect(audio.play).toHaveBeenCalledWith("https://audio.test/souq-eg.mp3");
  });
});

describe("words with no recording", () => {
  it("synthesises one in the word's own dialect", () => {
    render({ dialect: "Egyptian" });

    // Not the dialect the learner is studying: an Egyptian word read in a Gulf
    // voice teaches the wrong sounds for that word.
    expect(tts.asked[0]).toMatchObject({ text: WORD, skip: false, dialect: "Egyptian" });
  });

  it("does not synthesise over a recording it already has", () => {
    render({ audioUrl: RECORDING });

    expect(tts.asked[0]).toMatchObject({ skip: true });
  });

  it("hands the synthesised clip back to be kept", () => {
    const onAudioGenerated = vi.fn();
    render({ onAudioGenerated });

    // Paying for the same synthesis on every review of the same word is the
    // thing this callback exists to prevent.
    expect(tts.asked[0].persist).toBe(onAudioGenerated);
  });

  it("says it is working while the voice is made", () => {
    tts.loading = true;
    render();

    expect(screen.getByText("Preparing audio…")).toBeInTheDocument();
    expect(speaker()).toBeDisabled();
  });

  it("plays the synthesised clip once it arrives", () => {
    tts.urls[WORD] = "blob:generated";
    render();

    expect(audio.play).toHaveBeenCalledWith("blob:generated");
  });
});

describe("when there is nothing to hear", () => {
  it("says so rather than sitting silent", () => {
    render();

    // The card cannot be answered without audio, so it has to admit that.
    expect(screen.getByText("Audio unavailable for this word")).toBeInTheDocument();
    expect(speaker()).toBeDisabled();
  });

  it("offers another attempt at the voice", () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(tts.regenerate).toHaveBeenCalled();
  });

  it("offers no retry for a word whose recording simply failed to load", () => {
    render({ audioUrl: "" });

    // With a recorded clip there is nothing to regenerate — retrying would
    // synthesise over a file that is supposed to exist.
    expect(screen.getByText("Audio unavailable for this word")).toBeInTheDocument();
  });

  it("can still be revealed, so the learner is not stuck", () => {
    const { onReveal } = render();

    fireEvent.click(screen.getByRole("button", { name: /reveal/i }));

    expect(onReveal).toHaveBeenCalled();
  });
});
