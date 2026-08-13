import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Word } from "@/types/transcript";
import WordConfidence from "./WordConfidence";

/**
 * Per-word ASR confidence, coloured, inside a segment card.
 *
 * An editor cannot re-listen to every word of a long transcript, so the colour
 * is how they decide where to spend attention: green is almost certainly right,
 * red is almost certainly wrong, amber is the band worth checking. The other
 * half is the split affordance — a ✂ between two words that turns "these are
 * really two lines" into one click.
 */

const aWord = (word: string, confidence: number, start = 0): Word => ({
  word,
  start,
  end: start + 1,
  confidence,
});

const WORDS: Word[] = [aWord("مرحبا", 0.95, 0), aWord("بك", 0.7, 1), aWord("هنا", 0.4, 2)];

interface Options {
  words?: Word[];
  activeWordIndex?: number;
  hoveredBoundary?: number | null;
}

function renderWords({ words = WORDS, activeWordIndex, hoveredBoundary }: Options = {}) {
  const onWordClick = vi.fn();
  const onSplitAt = vi.fn();
  const onWordBoundaryHover = vi.fn();
  const result = render(
    <WordConfidence
      words={words}
      activeWordIndex={activeWordIndex}
      hoveredBoundary={hoveredBoundary}
      onWordClick={onWordClick}
      onSplitAt={onSplitAt}
      onWordBoundaryHover={onWordBoundaryHover}
    />,
  );
  return { ...result, onWordClick, onSplitAt, onWordBoundaryHover };
}

/** The split hit-zones between words — one fewer than there are words. */
const boundaries = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("span.inline-block")];

describe("WordConfidence — colouring by confidence", () => {
  it("renders every word", () => {
    renderWords();
    expect(screen.getByText("مرحبا")).toBeInTheDocument();
    expect(screen.getByText("بك")).toBeInTheDocument();
    expect(screen.getByText("هنا")).toBeInTheDocument();
  });

  it("leaves a confident word green", () => {
    renderWords();
    expect(screen.getByText("مرحبا").className).toContain("text-green-700");
  });

  it("marks the middle band amber", () => {
    renderWords();
    expect(screen.getByText("بك").className).toContain("text-amber-600");
  });

  it("marks a doubtful word red", () => {
    renderWords();
    expect(screen.getByText("هنا").className).toContain("text-red-600");
  });

  it.each([
    [0.85, "text-green-700"],
    [0.849, "text-amber-600"],
    [0.65, "text-amber-600"],
    [0.649, "text-red-600"],
  ])("puts %s in the %s band", (confidence, expected) => {
    renderWords({ words: [aWord("كلمة", confidence)] });
    expect(screen.getByText("كلمة").className).toContain(expected);
  });

  it("treats a missing score as the lowest confidence", () => {
    // ASR engines omit the field rather than sending zero, and an unscored word
    // is exactly the one an editor should look at.
    renderWords({ words: [{ word: "كلمة", start: 0, end: 1 } as Word] });
    expect(screen.getByText("كلمة").className).toContain("text-red-600");
  });

  it("lays the words out right to left", () => {
    const { container } = renderWords();
    expect(container.querySelector("span[dir='rtl']")).toBeInTheDocument();
  });

  it("renders nothing for a segment with no words", () => {
    renderWords({ words: [] });
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("WordConfidence — the playhead", () => {
  it("highlights the word being spoken", () => {
    renderWords({ activeWordIndex: 1 });
    expect(screen.getByText("بك").className).toContain("bg-blue-200");
  });

  it("highlights only that one", () => {
    renderWords({ activeWordIndex: 1 });
    expect(screen.getByText("مرحبا").className).not.toContain("bg-blue-200");
  });

  it("highlights nothing when nothing is playing", () => {
    const { container } = renderWords();
    expect(container.querySelector(".bg-blue-200")).toBeNull();
  });

  it("keeps the confidence colour under the highlight", () => {
    // The two are orthogonal: an editor scrubbing through playback still needs
    // to see which words were uncertain.
    renderWords({ activeWordIndex: 2 });
    expect(screen.getByText("هنا").className).toContain("text-red-600");
    expect(screen.getByText("هنا").className).toContain("bg-blue-200");
  });
});

describe("WordConfidence — selecting a word", () => {
  it("reports the word that was clicked", () => {
    const { onWordClick } = renderWords();
    fireEvent.click(screen.getByText("بك"));
    expect(onWordClick).toHaveBeenCalledWith(1);
  });

  it("can be reached from the keyboard", () => {
    const { onWordClick } = renderWords();
    fireEvent.keyDown(screen.getByText("هنا"), { key: "Enter" });
    expect(onWordClick).toHaveBeenCalledWith(2);
  });

  it("exposes each word as a control", () => {
    renderWords();
    expect(screen.getAllByRole("button", { name: /مرحبا|بك|هنا/ })).toHaveLength(3);
  });

  it("responds to Space as well as Enter", () => {
    // A real button fires on both, and a screen-reader user told "button" will
    // try Space. These words are the only keyboard route into the transcript,
    // so ignoring it withheld the whole feature from that user.
    const { onWordClick } = renderWords();
    fireEvent.keyDown(screen.getByText("بك"), { key: " " });
    expect(onWordClick).toHaveBeenCalledWith(1);
  });

  it("keeps Space from scrolling the transcript away", () => {
    renderWords();
    const handled = fireEvent.keyDown(screen.getByText("بك"), { key: " " });
    // fireEvent returns false when a handler called preventDefault.
    expect(handled).toBe(false);
  });

  it("ignores keys that are not Enter or Space", () => {
    const { onWordClick } = renderWords();
    fireEvent.keyDown(screen.getByText("بك"), { key: "a" });
    expect(onWordClick).not.toHaveBeenCalled();
  });
});

describe("WordConfidence — splitting between two words", () => {
  it("offers the scissors at the hovered boundary", () => {
    renderWords({ hoveredBoundary: 0 });
    expect(screen.getByTitle("Split here")).toBeInTheDocument();
  });

  it("offers it at one boundary only", () => {
    renderWords({ hoveredBoundary: 1 });
    expect(screen.getAllByTitle("Split here")).toHaveLength(1);
  });

  it("offers nothing when no boundary is hovered", () => {
    renderWords({ hoveredBoundary: null });
    expect(screen.queryByTitle("Split here")).not.toBeInTheDocument();
  });

  it("puts no boundary after the last word", () => {
    // Splitting after the final word would produce an empty second segment.
    const { container } = renderWords();
    expect(boundaries(container)).toHaveLength(WORDS.length - 1);
  });

  it("reports a boundary being entered and left", () => {
    const { container, onWordBoundaryHover } = renderWords();
    const boundary = boundaries(container)[0];

    fireEvent.mouseEnter(boundary);
    expect(onWordBoundaryHover).toHaveBeenLastCalledWith(0);

    fireEvent.mouseLeave(boundary);
    expect(onWordBoundaryHover).toHaveBeenLastCalledWith(null);
  });

  it("gives the hover zone a width a pointer can enter", () => {
    // This was `w-0`: a zero-width box. Margins are not part of an element's
    // hit area, so a pointer could never be inside it and onMouseEnter never
    // fired in a real browser — the scissors was reachable only if a parent set
    // `hoveredBoundary` some other way.
    const { container } = renderWords();
    const boundary = boundaries(container)[0];
    expect(boundary.className).toContain("w-2");
    expect(boundary.className).not.toContain("w-0");
  });

  it("pulls the zone back in so the words are no further apart", () => {
    const { container } = renderWords();
    expect(boundaries(container)[0].className).toContain("-mx-1");
  });

  it("reports a split separately from a word click", () => {
    // Both used to be onWordClick with the same index, so the parent was told
    // "index 1" for "select the second word" and for "split after the second
    // word" alike — and SegmentCard guessed between them by checking whether
    // that boundary happened to be hovered.
    const { onWordClick, onSplitAt } = renderWords({ hoveredBoundary: 1 });

    fireEvent.click(screen.getByTitle("Split here"));
    expect(onSplitAt).toHaveBeenCalledWith(1);
    expect(onWordClick).not.toHaveBeenCalled();
  });

  it("still reports a word click as a word click", () => {
    const { onWordClick, onSplitAt } = renderWords({ hoveredBoundary: 1 });
    fireEvent.click(screen.getByText("بك"));
    expect(onWordClick).toHaveBeenLastCalledWith(1);
    expect(onSplitAt).not.toHaveBeenCalled();
  });

  it("falls back to onWordClick for a caller that offers no split handler", () => {
    // Keeps the old contract working for anything that has not been updated.
    const onWordClick = vi.fn();
    render(
      <WordConfidence words={WORDS} onWordClick={onWordClick} hoveredBoundary={1} />,
    );
    fireEvent.click(screen.getByTitle("Split here"));
    expect(onWordClick).toHaveBeenCalledWith(1);
  });

  it("does not also select the word when the scissors is used", () => {
    // stopPropagation keeps the click off the word behind it, so the parent
    // hears about the split and nothing else.
    const { onWordClick, onSplitAt } = renderWords({ hoveredBoundary: 0 });
    fireEvent.click(screen.getByTitle("Split here"));
    expect(onSplitAt).toHaveBeenCalledTimes(1);
    expect(onWordClick).not.toHaveBeenCalled();
  });
});

describe("WordConfidence — without any handlers", () => {
  it("renders and survives being clicked", () => {
    render(<WordConfidence words={WORDS} />);
    fireEvent.click(screen.getByText("بك"));
    fireEvent.keyDown(screen.getByText("بك"), { key: "Enter" });
    expect(screen.getByText("بك")).toBeInTheDocument();
  });
});
