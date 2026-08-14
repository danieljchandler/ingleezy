import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VocabularyWord } from "@/components/design-system";
import { IntroCard } from "./IntroCard";

/**
 * The screen a learner meets a new word on, before the quiz asks them for it.
 *
 * The design is deliberately a test rather than a presentation: the picture and
 * the English are up front, the Arabic is hidden, and the prompt asks the
 * learner to say it themselves before revealing. Revealing also plays the
 * recording, so the first thing they hear is immediately after their own
 * attempt — which is the moment the comparison is worth anything.
 *
 * VocabularyCard is its own component with its own tests and is stood in for
 * here, so the reveal state is what stays visible.
 */

const card = vi.hoisted(() => ({
  clicks: [] as Array<() => void>,
}));
vi.mock("@/components/design-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/design-system")>()),
  VocabularyCard: ({ onCardClick }: { onCardClick: () => void }) => {
    card.clicks.push(onCardClick);
    return (
      <button type="button" data-testid="vocab-card" onClick={onCardClick}>
        card
      </button>
    );
  },
}));

const play = vi.hoisted(() => vi.fn(() => Promise.resolve()));

beforeEach(() => {
  card.clicks = [];
  play.mockClear();
  // jsdom's HTMLMediaElement has no playback; the shared setup already stubs
  // play, but this file needs the handle to assert on.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const aWord = (over: Partial<VocabularyWord> = {}): VocabularyWord =>
  ({
    id: "w1",
    word_arabic: "خبز",
    word_english: "bread",
    image_url: "https://cdn.test/bread.jpg",
    audio_url: "https://cdn.test/bread.mp3",
    ...over,
  }) as VocabularyWord;

function renderCard(word = aWord(), topicLabel?: string) {
  const onContinue = vi.fn();
  const result = render(
    <IntroCard word={word} onContinue={onContinue} topicLabel={topicLabel} />,
  );
  return { ...result, onContinue };
}

const revealButton = () => screen.getByRole("button", { name: /العربي$/ });
const audio = (container: HTMLElement) => container.querySelector("audio");

describe("IntroCard — before the Arabic is revealed", () => {
  it("asks the learner to try it themselves first", () => {
    render(<IntroCard word={aWord()} onContinue={vi.fn()} />);
    expect(screen.getByText("جرّب تقول معناها، بعدين اكشفها")).toBeInTheDocument();
  });

  it("keeps the Arabic off the screen", () => {
    renderCard();
    expect(screen.queryByText("خبز")).not.toBeInTheDocument();
  });

  it("shows the English, which is the prompt", () => {
    renderCard();
    expect(screen.getByText("bread")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("offers to show the Arabic", () => {
    renderCard();
    expect(revealButton()).toHaveTextContent("ورّني العربي");
  });

  it("names the topic when the caller supplies one", () => {
    renderCard(aWord(), "Food and drink");
    expect(screen.getByText("Food and drink")).toBeInTheDocument();
  });

  it("leaves the tag off when it does not", () => {
    renderCard();
    expect(screen.queryByText("Food and drink")).not.toBeInTheDocument();
  });

  it("plays nothing on arrival", () => {
    // Autoplaying would hand the learner the answer before they had tried.
    renderCard();
    expect(play).not.toHaveBeenCalled();
  });
});

describe("IntroCard — revealing", () => {
  it("shows the Arabic", () => {
    renderCard();
    fireEvent.click(revealButton());
    expect(screen.getByText("خبز")).toBeInTheDocument();
  });

  it("renders it right-to-left", () => {
    renderCard();
    fireEvent.click(revealButton());
    expect(screen.getByText("خبز")).toHaveAttribute("dir", "rtl");
  });

  it("plays the recording at the same moment", () => {
    renderCard();
    fireEvent.click(revealButton());
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("plays from the start each time", () => {
    // A learner reveals, hides, and reveals again to hear it twice; without the
    // rewind the second play resumes from the end and is silent.
    const { container } = renderCard();
    fireEvent.click(revealButton());
    audio(container)!.currentTime = 3;
    fireEvent.click(revealButton());
    fireEvent.click(revealButton());
    expect(audio(container)!.currentTime).toBe(0);
  });

  it("offers to hide it again", () => {
    renderCard();
    fireEvent.click(revealButton());
    expect(revealButton()).toHaveTextContent("أخفِ العربي");
  });

  it("hides it on a second tap", () => {
    renderCard();
    fireEvent.click(revealButton());
    fireEvent.click(revealButton());
    expect(screen.queryByText("خبز")).not.toBeInTheDocument();
    expect(screen.getByText("جرّب تقول معناها، بعدين اكشفها")).toBeInTheDocument();
  });

  it("plays nothing when hiding", () => {
    renderCard();
    fireEvent.click(revealButton());
    fireEvent.click(revealButton());
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("plays again on a re-reveal", () => {
    renderCard();
    fireEvent.click(revealButton());
    fireEvent.click(revealButton());
    fireEvent.click(revealButton());
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("survives a browser that refuses to play", () => {
    play.mockReturnValueOnce(Promise.reject(new Error("blocked")));
    renderCard();
    fireEvent.click(revealButton());
    expect(screen.getByText("خبز")).toBeInTheDocument();
  });
});

describe("IntroCard — moving to the next word", () => {
  it("hides the Arabic again", () => {
    // Without this the next word would arrive already revealed, and the learner
    // would never be asked to produce it.
    const { rerender } = renderCard();
    fireEvent.click(revealButton());
    expect(screen.getByText("خبز")).toBeInTheDocument();

    rerender(
      <IntroCard
        word={aWord({ id: "w2", word_arabic: "ماء", word_english: "water" })}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.queryByText("ماء")).not.toBeInTheDocument();
    expect(screen.getByText("جرّب تقول معناها، بعدين اكشفها")).toBeInTheDocument();
  });

  it("keeps the reveal when only the word's other fields change", () => {
    // Keyed on id, so a re-render carrying a freshly generated image must not
    // snatch the Arabic back mid-look.
    const { rerender } = renderCard();
    fireEvent.click(revealButton());
    rerender(
      <IntroCard word={aWord({ image_url: "https://cdn.test/new.jpg" })} onContinue={vi.fn()} />,
    );
    expect(screen.getByText("خبز")).toBeInTheDocument();
  });

  it("hands the learner on to the quiz", () => {
    const { onContinue } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "كمّل للاختبار" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("IntroCard — a word with no recording", () => {
  it("renders no audio element", () => {
    const { container } = renderCard(aWord({ audio_url: null }));
    expect(audio(container)).toBeNull();
  });

  it("still reveals the Arabic", () => {
    renderCard(aWord({ audio_url: null }));
    fireEvent.click(revealButton());
    expect(screen.getByText("خبز")).toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
  });

  it("does not tell the learner to tap for audio it does not have", () => {
    // A lesson imported without recordings — the normal state of a freshly
    // authored one — showed this line on every word, and the tap did nothing.
    renderCard(aWord({ audio_url: null }));
    expect(screen.queryByText("اضغط البطاقة تسمعها مرة ثانية")).not.toBeInTheDocument();
  });

  it("still offers the hint for a word that does have one", () => {
    renderCard();
    expect(screen.getByText("اضغط البطاقة تسمعها مرة ثانية")).toBeInTheDocument();
  });
});

/**
 * `hasPlayed` used to be set on a card tap and on the audio's `ended`, and then
 * read by nothing: not gated on, not displayed, and Continue enabled from the
 * first frame. It read like the remains of a rule that a learner should hear a
 * word before being quizzed on it — a product question, not a defect — so the
 * bookkeeping is gone and the tap now does the thing the card advertises.
 * Continue stays open from the start, which these cases pin.
 */
describe("IntroCard — hearing the word is not required", () => {
  it("lets the learner continue without hearing the word", () => {
    const { onContinue } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "كمّل للاختبار" }));
    expect(play).not.toHaveBeenCalled();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("looks no different after the card has been tapped", () => {
    const { container } = renderCard();
    const before = container.innerHTML;
    fireEvent.click(screen.getByTestId("vocab-card"));
    expect(container.innerHTML).toBe(before);
  });

  it("looks no different after the clip has finished", () => {
    const { container } = renderCard();
    fireEvent.click(revealButton());
    const before = container.innerHTML;
    fireEvent.ended(audio(container)!);
    expect(container.innerHTML).toBe(before);
  });
});
