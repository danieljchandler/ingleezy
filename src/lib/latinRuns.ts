/**
 * Split mixed Arabic/English text into runs, so the English can be set apart.
 *
 * The tutor's corrections are an Arabic sentence with the English fix inside
 * it («قول "I went" لأن yesterday ماضي»). Left as one string, the bidi
 * algorithm is free to move the English and the punctuation around it, and the
 * part the learner needs to read is set in the Arabic face at Arabic weight.
 * Wrapping each English run in its own isolate (`<bdi>`) pins its order and
 * lets it carry the English font and the gold highlight.
 *
 * A run starts and ends on a Latin letter and may span spaces, apostrophes
 * and hyphens, so "I went to the market" is one run and the guillemets or
 * quotes around it stay with the Arabic.
 */
export interface TextRun {
  text: string;
  latin: boolean;
}

const LATIN_RUN = /[A-Za-z](?:[A-Za-z'’\- ]*[A-Za-z])?/g;

export function splitLatinRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of text.matchAll(LATIN_RUN)) {
    const start = match.index ?? 0;
    if (start > last) runs.push({ text: text.slice(last, start), latin: false });
    runs.push({ text: match[0], latin: true });
    last = start + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), latin: false });
  return runs;
}
