import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ARABIC_LETTERS, type ArabicLetter } from "@/data/arabicAlphabet";
import { SoundMatchGame } from "./SoundMatchGame";

/**
 * "Which letter did you just hear?"
 *
 * The alphabet lessons teach a letter's shape and its sound separately, and
 * this is the exercise that joins them: the glyph is never shown as the prompt,
 * only played, so the only way through is to have attached the sound to the
 * shape rather than to have memorised a position in a list.
 *
 * The distractors matter as much as the target. They are drawn from the letters
 * the learner has already met, because telling ب from ت is the actual skill —
 * telling ب from a letter you have never seen is not.
 */

const audio = vi.hoisted(() => ({ played: [] as string[] }));
vi.mock("./LetterAudioButton", () => ({
  LetterAudioButton: ({ text, label }: { text: string; label?: string }) => {
    audio.played.push(text);
    return <button aria-label={label}>{text}</button>;
  },
}));

const byCode = (code: string) => ARABIC_LETTERS.find((l) => l.code === code)!;

/** Three letters a beginner meets early, so the pool is realistic. */
const BAA = byCode("beh") ?? ARABIC_LETTERS[1];
const POOL: ArabicLetter[] = ARABIC_LETTERS.slice(0, 6);

let cleanup: (() => void) | undefined;

beforeEach(() => {
  audio.played = [];
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

function render({
  letter = POOL[1],
  pool = POOL,
}: { letter?: ArabicLetter; pool?: ArabicLetter[] } = {}) {
  const onComplete = vi.fn();
  const harness = renderWithProviders(
    <SoundMatchGame letter={letter} pool={pool} onComplete={onComplete} />,
    { persona: "free" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onComplete, letter };
}

const tiles = () =>
  screen.getAllByRole("button").filter((b) => b.getAttribute("aria-label") === null);

const tileFor = (letter: ArabicLetter) =>
  tiles().find((b) => b.textContent === letter.isolated)!;

describe("posing the question", () => {
  it("says what to do", () => {
    render();

    expect(
      screen.getByText("Tap the speaker, then pick the letter you heard"),
    ).toBeInTheDocument();
  });

  it("plays the letter's name rather than showing it", () => {
    const { letter } = render();

    // The glyph as a prompt would make this a matching exercise with the answer
    // already on screen.
    expect(audio.played).toContain(letter.name_ar);
  });

  it("offers four letters to choose between", () => {
    render();

    expect(tiles()).toHaveLength(4);
  });

  it("always includes the letter that was played", () => {
    const { letter } = render();

    expect(tileFor(letter)).toBeInTheDocument();
  });

  it("draws the wrong answers from letters the learner has met", () => {
    render({ letter: POOL[1], pool: POOL });

    // Telling ب from ت is the skill. Telling ب from a letter never seen is not.
    for (const tile of tiles()) {
      expect(POOL.map((l) => l.isolated)).toContain(tile.textContent);
    }
  });

  it("tops up from the whole alphabet when too few letters have been met", () => {
    const twoLetters = ARABIC_LETTERS.slice(0, 2);
    render({ letter: twoLetters[0], pool: twoLetters });

    // Two tiles would make it a coin toss, and the first lesson is exactly where
    // that matters most.
    expect(tiles()).toHaveLength(4);
  });

  it("never offers the same letter twice", () => {
    render();

    const shown = tiles().map((b) => b.textContent);
    expect(new Set(shown).size).toBe(shown.length);
  });
});

describe("answering", () => {
  it("says so and scores full marks for the right letter", () => {
    const { onComplete, letter } = render();

    fireEvent.click(tileFor(letter));

    expect(screen.getByText(/Correct!/)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith(100);
  });

  it("names the letter it actually was after a wrong answer", () => {
    const { onComplete, letter } = render();
    const wrong = tiles().find((b) => b.textContent !== letter.isolated)!;

    fireEvent.click(wrong);

    // Being told you were wrong without being told which letter it was leaves
    // the sound attached to nothing. The glyph and its reading are separate
    // elements inside the sentence, so read the whole line.
    const answer = screen.getByText(/The letter was/).textContent ?? "";
    expect(answer).toContain(letter.isolated);
    expect(answer).toContain(letter.name_translit);
    expect(onComplete).toHaveBeenCalledWith(0);
  });

  it("marks the right tile even when the learner missed it", () => {
    const { letter } = render();
    const wrong = tiles().find((b) => b.textContent !== letter.isolated)!;

    fireEvent.click(wrong);

    expect(tileFor(letter).className).toContain("border-green");
    expect(wrong.className).toContain("border-red");
  });

  it("takes no second answer", () => {
    const { onComplete, letter } = render();

    fireEvent.click(tiles().find((b) => b.textContent !== letter.isolated)!);
    fireEvent.click(tileFor(letter));

    // Otherwise the learner taps until the green one appears and the lesson
    // records a pass for a letter they cannot hear.
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(0);
    for (const tile of tiles()) expect(tile).toBeDisabled();
  });
});

describe("the next letter", () => {
  it("starts over rather than carrying the last answer across", () => {
    const { rerender, letter } = render();
    fireEvent.click(tileFor(letter));
    expect(screen.getByText(/Correct!/)).toBeInTheDocument();

    act(() => {
      rerender(
        <SoundMatchGame letter={POOL[3]} pool={POOL} onComplete={vi.fn()} />,
      );
    });

    // A tick left over from the previous letter reads as a pass on this one.
    expect(screen.queryByText(/Correct!/)).toBeNull();
    for (const tile of tiles()) expect(tile).toBeEnabled();
  });

  it("plays the new letter", () => {
    const { rerender } = render();
    audio.played = [];

    act(() => {
      rerender(
        <SoundMatchGame letter={POOL[3]} pool={POOL} onComplete={vi.fn()} />,
      );
    });

    expect(audio.played).toContain(POOL[3].name_ar);
  });
});
