import type { Word } from '@/types/transcript';
import { cn } from '@/lib/utils';

interface WordConfidenceProps {
  words: Word[];
  activeWordIndex?: number;
  onWordClick?: (index: number) => void;
  /**
   * Split after word `index`.
   *
   * Separate from `onWordClick` because the scissors used to call that with the
   * same index as clicking word `i` itself, leaving the parent unable to tell
   * "select the second word" from "split after the second word" — SegmentCard
   * guessed between them by checking whether that boundary happened to be
   * hovered, which misreads a click on a word whose own boundary is under the
   * pointer.
   */
  onSplitAt?: (index: number) => void;
  onWordBoundaryHover?: (index: number | null) => void;
  hoveredBoundary?: number | null;
}

/** Colour class based on confidence threshold. */
function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return 'text-green-700 dark:text-green-400';
  if (confidence >= 0.65) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

/**
 * Renders words with per-word confidence coloring and active-word highlighting.
 * Shows a ✂ split icon on hover between word boundaries.
 */
export default function WordConfidence({
  words,
  activeWordIndex = -1,
  onWordClick,
  onSplitAt,
  onWordBoundaryHover,
  hoveredBoundary,
}: WordConfidenceProps) {
  return (
    <span dir="rtl" className="inline text-right font-cairo leading-relaxed">
      {words.map((w, i) => (
        <span key={`${w.start}-${i}`} className="relative inline">
          <span
            role="button"
            tabIndex={0}
            className={cn(
              'cursor-pointer rounded px-0.5 transition-colors',
              confidenceColor(w.confidence),
              activeWordIndex === i && 'bg-blue-200 dark:bg-blue-800',
            )}
            onClick={() => onWordClick?.(i)}
            // Space as well as Enter. A real button fires on both, and a
            // screen-reader user told "button" will try Space — these words are
            // the only keyboard route to the split, so ignoring it withheld the
            // whole feature from that user. preventDefault stops Space
            // scrolling the transcript out from under them.
            onKeyDown={e => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onWordClick?.(i);
            }}
          >
            {w.word}
          </span>
          {/* Split boundary indicator — show between words, not after the last */}
          {i < words.length - 1 && (
            <span
              // Eight pixels wide, pulled back in by the negative margins so the
              // words sit exactly as far apart as before. This was `w-0`: a
              // zero-width box, and margins are not part of an element's hit
              // area, so a pointer could never be inside it and onMouseEnter
              // never fired in a real browser. The scissors was reachable only
              // if a parent set `hoveredBoundary` some other way — which is why
              // it could be driven by prop but never by hovering.
              className="relative -mx-1 inline-block w-2 align-middle"
              onMouseEnter={() => onWordBoundaryHover?.(i)}
              onMouseLeave={() => onWordBoundaryHover?.(null)}
            >
              {hoveredBoundary === i && (
                <button
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs text-gray-500 hover:text-red-500 transition-colors"
                  title="Split here"
                  onClick={e => {
                    e.stopPropagation();
                    (onSplitAt ?? onWordClick)?.(i);
                  }}
                >
                  ✂
                </button>
              )}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
