import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ARABIC_LETTERS, type ArabicLetter } from "@/data/arabicAlphabet";
import { SpotTheLetterGame } from "./SpotTheLetterGame";

/**
 * "Tap every word containing this letter."
 *
 * Recognising a letter in isolation is nearly useless: Arabic letters change
 * shape depending on where they sit in a word, and a learner who only knows the
 * isolated glyph cannot read anything. This is the exercise that closes that
 * gap, which is why the words are real example words rather than a list of
 * glyphs.
 *
 * Two subtleties carry it. Scoring counts *every* word, so leaving a target
 * untapped costs as much as tapping a filler — otherwise tapping everything
 * would score full marks. And the letter comparison normalises the Arabic, so
 * أ and إ and ٱ all count as alif, which is what a reader sees.
 */

const byIsolated = (glyph: string) => ARABIC_LETTERS.find((l) => l.isolated === glyph)!;

/** Enough letters that the grid has both target words and fillers to draw on. */
const POOL: ArabicLetter[] = ARABIC_LETTERS.slice(0, 8);

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render({
  letter = POOL[1],
  pool = POOL,
}: { letter?: ArabicLetter; pool?: ArabicLetter[] } = {}) {
  const onComplete = vi.fn();
  const harness = renderWithProviders(
    <SpotTheLetterGame letter={letter} pool={pool} onComplete={onComplete} />,
    { persona: "free" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onComplete, letter };
}

const wordTiles = () =>
  screen.getAllByRole("button").filter((b) => b.textContent !== "Check answers");

const check = () => fireEvent.click(screen.getByRole("button", { name: /check answers/i }));

/** The same normalisation the game uses, so the test agrees on what "contains" means. */
const normalise = (s: string) =>
  s
    .replace(/[ً-ْـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه");

const contains = (word: string, letter: ArabicLetter) =>
  normalise(word).includes(normalise(letter.isolated));

describe("posing the question", () => {
  it("names the letter to hunt for", () => {
    const { letter } = render();

    expect(screen.getByText("Tap every word containing")).toBeInTheDocument();
    expect(screen.getByText(letter.isolated)).toBeInTheDocument();
  });

  it("shows a grid of real words", () => {
    render();

    // Real example words rather than glyphs: the point is recognising the letter
    // in its joined forms, which only happens inside a word.
    expect(wordTiles()).toHaveLength(8);
    for (const tile of wordTiles()) {
      expect(tile.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("mixes words that contain the letter with words that do not", () => {
    const { letter } = render();
    const words = wordTiles().map((b) => b.textContent!.trim());

    // A grid where every word is correct teaches tapping, not reading — and the
    // very first letter is exactly where that would happen.
    expect(words.some((w) => contains(w, letter))).toBe(true);
    expect(words.some((w) => !contains(w, letter))).toBe(true);
  });

  it("never repeats a word", () => {
    render();

    const words = wordTiles().map((b) => b.textContent!.trim());
    expect(new Set(words).size).toBe(words.length);
  });
});

describe("answering", () => {
  it("marks a word as chosen when tapped", () => {
    render();

    fireEvent.click(wordTiles()[0]);

    expect(wordTiles()[0].className).toContain("border-primary");
  });

  it("lets a tap be taken back", () => {
    render();
    fireEvent.click(wordTiles()[0]);

    fireEvent.click(wordTiles()[0]);

    expect(wordTiles()[0].className).not.toContain("border-primary");
  });

  it("scores full marks for tapping exactly the right words", () => {
    const { onComplete, letter } = render();

    for (const tile of wordTiles()) {
      if (contains(tile.textContent!.trim(), letter)) fireEvent.click(tile);
    }
    check();

    expect(onComplete).toHaveBeenCalledWith(100);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("Excellent! 🌟")).toBeInTheDocument();
  });

  it("counts a missed word against the learner, not just a wrong tap", () => {
    const { onComplete, letter } = render();
    const words = wordTiles().map((b) => b.textContent!.trim());
    const targets = words.filter((w) => contains(w, letter));

    // Tap all but one of the right words and nothing else.
    for (const tile of wordTiles()) {
      const word = tile.textContent!.trim();
      if (contains(word, letter) && word !== targets[0]) fireEvent.click(tile);
    }
    check();

    // Scoring every word is what stops "tap everything" being a winning
    // strategy — the omission has to cost the same as a false positive.
    const expected = Math.round(((words.length - 1) / words.length) * 100);
    expect(onComplete).toHaveBeenCalledWith(expected);
  });

  it("scores tapping nothing by how many words were fillers", () => {
    const { onComplete, letter } = render();
    const words = wordTiles().map((b) => b.textContent!.trim());
    const fillers = words.filter((w) => !contains(w, letter)).length;

    check();

    // Not zero: the fillers were correctly left alone. Reporting zero would tell
    // a learner they got nothing right when they half did.
    expect(onComplete).toHaveBeenCalledWith(Math.round((fillers / words.length) * 100));
  });

  it("shows which words did contain the letter", () => {
    const { letter } = render();

    check();

    // The grid becomes the answer key — the learner sees the letter in each of
    // its joined shapes, which is the thing being taught.
    for (const tile of wordTiles()) {
      const marked = tile.querySelector(".lucide-check") !== null;
      expect(marked).toBe(contains(tile.textContent!.trim(), letter));
    }
  });

  it("takes no more taps once the answers are in", () => {
    render();

    check();

    for (const tile of wordTiles()) expect(tile).toBeDisabled();
    expect(screen.queryByRole("button", { name: /check answers/i })).toBeNull();
  });

  it("encourages a middling score rather than calling it a failure", () => {
    const { letter } = render();
    const words = wordTiles().map((b) => b.textContent!.trim());
    // Tap every word: every filler is wrong, every target right.
    for (const tile of wordTiles()) fireEvent.click(tile);

    check();

    const targets = words.filter((w) => contains(w, letter)).length;
    const score = Math.round((targets / words.length) * 100);
    expect(screen.getByText(`${score}%`)).toBeInTheDocument();
    expect(
      screen.getByText(
        score >= 80 ? "Excellent! 🌟" : score >= 50 ? "Good — keep going" : "Try again to lock it in",
      ),
    ).toBeInTheDocument();
  });
});

describe("the next letter", () => {
  it("clears the previous answers", () => {
    const { rerender } = render();
    fireEvent.click(wordTiles()[0]);
    check();

    act(() => {
      rerender(<SpotTheLetterGame letter={POOL[4]} pool={POOL} onComplete={vi.fn()} />);
    });

    // A graded grid carried over would show the last letter's answers against
    // this letter's words.
    expect(screen.getByRole("button", { name: /check answers/i })).toBeInTheDocument();
    for (const tile of wordTiles()) expect(tile).toBeEnabled();
  });
});
