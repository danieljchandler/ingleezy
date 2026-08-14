import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ReviewAudioCard } from "./ReviewAudioCard";

/**
 * The listening-recall card: hear the English word, say what it means.
 *
 * Every other deck in the app shows a written word and asks for the meaning,
 * which tests reading. This is the direction that matters for catching real
 * speech — recognising "market" on a page says nothing about catching it at
 * conversational speed.
 *
 * So the text is hidden until the learner reveals it, the audio plays itself
 * as soon as it exists (a silent card is unanswerable), and synthesis always
 * uses an English voice — the target word is English for every learner.
 */

const tts = vi.hoisted(() => ({
  urls: {} as Record<string, string>,
  loading: false,
  asked: [] as Array<{ text: string; skip?: boolean; voice?: string; persist?: unknown }>,
  regenerate: vi.fn(),
}));

vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: {
    text: string;
    skip?: boolean;
    voice?: string;
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

const speaker = () => screen.getByRole("button", { name: "أعد تشغيل الكلمة" });

describe("posing the question", () => {
  it("says what kind of card this is", () => {
    render();

    expect(screen.getByText("استمع")).toBeInTheDocument();
  });

  it("keeps the text hidden so the audio is the only way through", () => {
    render();

    // A written word on screen turns a listening card into a reading card.
    expect(screen.queryByText(WORD)).toBeNull();
    expect(screen.queryByText("market")).toBeNull();
    expect(screen.getByRole("button", { name: "أظهر الإجابة" })).toBeInTheDocument();
  });

  it("shows both halves once the learner reveals", () => {
    render({ showAnswer: true });

    // The English word the learner just heard leads; the Arabic gloss follows.
    expect(screen.getByText("market")).toHaveClass("font-english");
    expect(screen.getByText(WORD)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "أظهر الإجابة" })).toBeNull();
  });

  it("asks the page to reveal rather than deciding itself", () => {
    const { onReveal } = render();

    fireEvent.click(screen.getByRole("button", { name: "أظهر الإجابة" }));

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
    expect(screen.getByText("ماذا تعني؟")).toBeInTheDocument();
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

    // Mix All serves the same word from several dialect decks. Keyed on the
    // word alone, the second card would sit silent.
    expect(audio.play).toHaveBeenCalledWith("https://audio.test/souq-eg.mp3");
  });
});

describe("words with no recording", () => {
  it("synthesises the English word with an English voice", () => {
    render({ dialect: "Egyptian" });

    // The audio is the English target — dialect voices are Arabic-scaffold
    // machinery and must not leak into it.
    expect(tts.asked[0]).toMatchObject({ text: "market", skip: false, voice: "en-US-JennyNeural" });
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

    expect(screen.getByText("جارٍ تجهيز الصوت…")).toBeInTheDocument();
    expect(speaker()).toBeDisabled();
  });

  it("plays the synthesised clip once it arrives", () => {
    tts.urls["market"] = "blob:generated";
    render();

    expect(audio.play).toHaveBeenCalledWith("blob:generated");
  });
});

describe("when there is nothing to hear", () => {
  it("says so rather than sitting silent", () => {
    render();

    // The card cannot be answered without audio, so it has to admit that.
    expect(screen.getByText("لا يتوفر صوت لهذه الكلمة")).toBeInTheDocument();
    expect(speaker()).toBeDisabled();
  });

  it("offers another attempt at the voice", () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: "أعد المحاولة" }));

    expect(tts.regenerate).toHaveBeenCalled();
  });

  it("offers no retry for a word whose recording simply failed to load", () => {
    render({ audioUrl: "" });

    // With a recorded clip there is nothing to regenerate — retrying would
    // synthesise over a file that is supposed to exist.
    expect(screen.getByText("لا يتوفر صوت لهذه الكلمة")).toBeInTheDocument();
  });

  it("can still be revealed, so the learner is not stuck", () => {
    const { onReveal } = render();

    fireEvent.click(screen.getByRole("button", { name: "أظهر الإجابة" }));

    expect(onReveal).toHaveBeenCalled();
  });
});
