import type { Segment, Word } from '@/types/transcript';

/**
 * Compute the arithmetic mean of an array of numbers.
 * Returns 0 for an empty array.
 */
export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Split a segment into two at the boundary after the given word index.
 *
 * @param segment  - The segment to split.
 * @param splitAfterWordIndex - Index of the last word that stays in the left segment.
 * @returns A tuple `[leftSegment, rightSegment]`.
 * @throws If `splitAfterWordIndex` is out of range or would produce an empty segment.
 *
 * @example
 * ```ts
 * const [a, b] = splitSegment(segment, 2);
 * // a.words = segment.words[0..2], b.words = segment.words[3..]
 * ```
 */
export function splitSegment(
  segment: Segment,
  splitAfterWordIndex: number,
): [Segment, Segment] {
  if (splitAfterWordIndex < 0 || splitAfterWordIndex >= segment.words.length - 1) {
    throw new RangeError(
      `splitAfterWordIndex must be between 0 and ${segment.words.length - 2} (got ${splitAfterWordIndex})`,
    );
  }

  const leftWords: Word[] = segment.words.slice(0, splitAfterWordIndex + 1);
  const rightWords: Word[] = segment.words.slice(splitAfterWordIndex + 1);

  const segA: Segment = {
    ...segment,
    end: leftWords[leftWords.length - 1].end,
    text: leftWords.map(w => w.word).join(' '),
    words: leftWords,
    confidence: avg(leftWords.map(w => w.confidence)),
  };

  const segB: Segment = {
    ...segment,
    id: crypto.randomUUID(),
    start: rightWords[0].start,
    text: rightWords.map(w => w.word).join(' '),
    words: rightWords,
    confidence: avg(rightWords.map(w => w.confidence)),
  };

  return [segA, segB];
}

/**
 * Split a segment at a cursor position within text.
 *
 * Attempts to find the word boundary that the cursor falls after by accumulating
 * character lengths. Falls back to time-interpolation when words don't match
 * the current (possibly edited) text.
 *
 * @param segment    - The segment to split.
 * @param cursorPos  - Character index within `currentText` where the split should occur.
 * @param currentText - The text as currently shown in the editor (may differ from segment.text after edits).
 * @returns A tuple `[leftSegment, rightSegment]`.
 */
export function splitSegmentAtCursor(
  segment: Segment,
  cursorPos: number,
  currentText: string,
): [Segment, Segment] {
  const textBefore = currentText.slice(0, cursorPos).trim();
  const textAfter = currentText.slice(cursorPos).trim();

  if (!textBefore || !textAfter) {
    throw new RangeError('cursorPos must leave non-empty text on both sides');
  }

  // Try to map cursor position to a word index by walking through segment.words.
  // Words are joined with spaces: "w0 w1 w2 ..."
  let charCount = 0;
  let splitAfterWordIndex = -1;
  for (let i = 0; i < segment.words.length; i++) {
    if (i > 0) charCount += 1; // space between words
    charCount += segment.words[i].word.length;
    if (charCount >= cursorPos && i < segment.words.length - 1) {
      splitAfterWordIndex = i;
      break;
    }
  }

  if (splitAfterWordIndex >= 0) {
    // Clean word-level split with accurate timing.
    return splitSegment(segment, splitAfterWordIndex);
  }

  // Fallback: interpolate split time by character-position ratio.
  const ratio = Math.max(0.01, Math.min(0.99, cursorPos / currentText.length));
  const splitTime = Math.round((segment.start + ratio * (segment.end - segment.start)) * 1000) / 1000;

  const leftWords = segment.words.filter(w => w.end <= splitTime);
  const rightWords = segment.words.filter(w => w.start >= splitTime);

  const segA: Segment = {
    ...segment,
    end: splitTime,
    text: textBefore,
    words: leftWords,
    confidence: leftWords.length > 0 ? avg(leftWords.map(w => w.confidence)) : segment.confidence,
  };

  const segB: Segment = {
    ...segment,
    id: crypto.randomUUID(),
    start: splitTime,
    text: textAfter,
    words: rightWords,
    confidence: rightWords.length > 0 ? avg(rightWords.map(w => w.confidence)) : segment.confidence,
  };

  return [segA, segB];
}

/**
 * Merge two adjacent segments into one.
 *
 * @param segA - The earlier segment (by time).
 * @param segB - The later segment (by time).
 * @returns A single merged segment keeping `segA.id`.
 *
 * @example
 * ```ts
 * const merged = mergeSegments(segA, segB);
 * // merged.words = [...segA.words, ...segB.words]
 * ```
 */
export function mergeSegments(segA: Segment, segB: Segment): Segment {
  const allWords = [...segA.words, ...segB.words];
  return {
    ...segA,
    end: segB.end,
    text: segA.text + ' ' + segB.text,
    words: allWords,
    confidence: avg(allWords.map(w => w.confidence)),
  };
}
