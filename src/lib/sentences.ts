// Breaking a body of Arabic into the sentences a learner works through one at
// a time, and lining a paragraph's translations up with them.
//
// The reading surfaces (Souq News, Today's Story) all present a body one
// sentence to a card rather than as a block: a wall of unfamiliar script is
// where a learner stops reading. Generators that emit per-sentence text feed
// those cards directly; the ones that only emit whole paragraphs come through
// here.

/** One card's worth of text: the Arabic plus whatever was written about it. */
export interface ReaderSentence {
  arabic: string;
  transliteration?: string;
  english?: string;
  literal?: string;
}

// ؟ is a different code point from ?, and dialect text uses it — a splitter
// that only knew the Latin one would run two sentences together. Line breaks
// end a sentence too, since a generator that laid the body out in paragraphs
// meant those breaks.
const SENTENCE_BREAK = /(?<=[.!?؟])\s+|\n+/g;

/** Split text on sentence endings, dropping the empty pieces they leave. */
export function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Turn a whole-paragraph body into per-sentence lines.
 *
 * A translation is only attached when its own sentence count matches the
 * Arabic's, because the pairing is by position and nothing else: if the
 * English ran the first two Arabic sentences together, every line after it
 * would be labelled with the wrong meaning — and that label is what the word
 * lookup sends to the model and what a learner then saves onto a flashcard. A
 * missing translation is honest; a confidently wrong one is not.
 *
 * The exception is a body that is a single sentence, where whatever the
 * translation splits into is still a translation of that one line.
 */
export function pairSentences(body: {
  arabic: string;
  transliteration?: string | null;
  english?: string | null;
  literal?: string | null;
}): ReaderSentence[] {
  const arabic = splitSentences(body.arabic);
  if (arabic.length === 0) return [];

  const align = (text?: string | null): (string | undefined)[] => {
    const trimmed = (text ?? "").trim();
    if (!trimmed) return arabic.map(() => undefined);
    if (arabic.length === 1) return [trimmed];
    const parts = splitSentences(trimmed);
    if (parts.length !== arabic.length) return arabic.map(() => undefined);
    return parts;
  };

  const transliteration = align(body.transliteration);
  const english = align(body.english);
  const literal = align(body.literal);

  return arabic.map((line, i) => ({
    arabic: line,
    transliteration: transliteration[i],
    english: english[i],
    literal: literal[i],
  }));
}
