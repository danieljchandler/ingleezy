// =============================================================================
// Arabic diacritic handling: stripping, match-normalisation, and overlaying a
// diacritizer's output onto the pipeline's own lines.
//
// Two bugs lived in the version this replaces, and together they meant a
// *successful* Farasa call contributed nothing — audits saw "246 chars of
// tashkeel returned, 0/11 lines updated".
//
//   1. Words were compared with exact string equality after removing tashkeel
//      only. Farasa normalises orthography — hamza carriers (أ إ آ ٱ) collapse
//      to bare alef, tatweel disappears, punctuation splits off — so a word the
//      LLM wrote as "أَنَا" and Farasa returned as "انَا" compared unequal and
//      was skipped.
//   2. In the line-count-mismatch path (the usual one, because the diacritizer
//      returns a single blob rather than the newlines it was sent), a miss left
//      the read cursor where it was. One unmatched word desynced the stream
//      permanently, so every later word missed too. That is how the count
//      reaches exactly zero rather than merely being low.
//
// Overlay direction matters as much as alignment. Call 1 is required to emit
// lines "FULLY voweled with tashkeel that matches HOW THE SPEAKER ACTUALLY
// PRONOUNCES IT ... NOT the MSA standard". Farasa is an MSA diacritizer, so
// letting it overwrite those marks would undo the dialect accuracy the prompt
// works to get. It therefore *fills gaps*: a word that arrives unvoweled can
// take Farasa's marks, a word that already carries dialect tashkeel keeps them.
// =============================================================================

/**
 * Tashkeel: fatha through sukun, shadda, tanwin, and the dagger alif.
 *
 * Explicit escapes on purpose. The literal class that reads as "U+064B
 * through U+0670" silently also spans U+0660-U+0669 -- the Arabic-Indic
 * digits -- so writing it that way corrupts every number in a transcript.
 */
const DIACRITICS = /[\u064B-\u065F\u0670]/g;

/** Tatweel (kashida) — decorative letter-stretching, never phonemic. */
const TATWEEL = /\u0640/g;

/** Zero-width marks that survive copy-paste out of some sources. */
const ZERO_WIDTH = /[\u200B-\u200F\u2060\uFEFF]/g;

const EDGE_PUNCTUATION = /^[،؟.!:؛…\-—–"'()[\]{}«»]+|[،؟.!:؛…\-—–"'()[\]{}«»]+$/g;

export function stripDiacritics(text: string): string {
  return text.replace(DIACRITICS, '');
}

/** Does this word carry any tashkeel at all? */
export function hasDiacritics(word: string): boolean {
  return /[\u064B-\u065F\u0670]/.test(word);
}

/**
 * Reduce a word to the form used for *matching only* — never for output.
 *
 * Collapses the orthographic variation diacritizers introduce, so "أَنَا" and
 * "انَا" are recognised as the same word. Deliberately does not touch ta marbuta
 * (ة/ه) or final ya (ي/ى) beyond the alef-maqsura case: those distinctions
 * separate genuinely different words often enough that normalising them would
 * trade missed matches for wrong ones.
 */
export function normalizeArabicForMatch(word: string): string {
  return stripDiacritics(word)
    .replace(ZERO_WIDTH, '')
    .replace(TATWEEL, '')
    // Farasa's clitic-boundary marker. Its segmenting endpoints return
    // "و+ال+كتاب" for "والكتاب", and leaving the plus in place makes every
    // affixed word — which in Arabic is most of them — compare unequal.
    .replace(/\+/g, '')
    .replace(EDGE_PUNCTUATION, '')
    // Hamza carriers → bare alef. This is the normalisation Farasa applies.
    .replace(/[أإآٱ]/g, 'ا')
    // Alef maqsura → ya. "إلى" comes back as "الي" from some endpoints.
    .replace(/ى/g, 'ي')
    .trim();
}

/** Words match if they are the same word ignoring vowels and orthography. */
function sameWord(a: string, b: string): boolean {
  const na = normalizeArabicForMatch(a);
  return na.length > 0 && na === normalizeArabicForMatch(b);
}

/**
 * Merge one diacritized word into the original.
 *
 * The original's letters always win — it carries the dialect spelling Call 1
 * chose, and the diacritizer's normalised form would be a downgrade. Only the
 * marks are taken, and only when the original has none.
 */
/**
 * Move the marks from `diacritized` onto `bare`, letter for letter.
 *
 * Only valid when the two have the same number of base letters — the caller
 * checks that. Returns null if they turn out not to, so a desync can never
 * silently produce a mangled word.
 */
function transplantMarks(bare: string, diacritized: string): string | null {
  const out: string[] = [];
  let i = 0;
  for (const ch of diacritized) {
    if (/[ً-ٰٟ]/.test(ch)) { out.push(ch); continue; }
    if (i >= bare.length) return null;
    out.push(bare[i++]);
  }
  return i === bare.length ? out.join('') : null;
}

function mergeWord(original: string, rawDiacritized: string): string {
  if (hasDiacritics(original)) return original;
  // Clitic boundaries are annotation, not letters — they must come off before
  // the skeletons are compared or transplanted onto, or every segmented word
  // looks like a respelling and keeps its bare form.
  const diacritized = rawDiacritized.replace(/\+/g, '');
  if (!hasDiacritics(diacritized)) return original;
  const bareOriginal = stripDiacritics(original);
  const bareDiacritized = stripDiacritics(diacritized);
  // Identical skeletons: the marks are already sitting on the right letters.
  if (bareOriginal === bareDiacritized) return diacritized;
  // Same letter count, different spelling — a hamza carrier (ا vs أ/إ/آ) or an
  // alef maqsura. The letters correspond one to one, so take the marks but keep
  // our own letters: Call 1 chose the dialect spelling deliberately, and the
  // diacritizer's normalised form would be a downgrade.
  if (bareOriginal.length === bareDiacritized.length) {
    return transplantMarks(bareOriginal, diacritized) ?? original;
  }
  // Lengths differ: the diacritizer respelled the word, adding or dropping
  // letters. Marks would land on the wrong ones — keep what we had.
  return original;
}

export interface OverlayResult {
  lines: string[];
  /** Words that were located in the diacritizer's output. */
  matched: number;
  /** Words actually rewritten — always <= matched, since voweled words keep theirs. */
  filled: number;
  /** Total words considered. */
  total: number;
  /** Which alignment path ran, for provenance. */
  strategy: 'per-line' | 'word-stream' | 'none';
}

/**
 * Overlay diacritized text onto the original lines.
 *
 * Takes the per-line path when the diacritizer preserved the newlines it was
 * sent, and otherwise treats its output as one word stream walked in order.
 */
export function overlayDiacritizedLines(
  originalLines: string[],
  diacritizedTranscript: string | null | undefined,
): OverlayResult {
  const total = originalLines.reduce(
    (n, l) => n + l.split(/\s+/).filter(Boolean).length,
    0,
  );
  if (!diacritizedTranscript || !diacritizedTranscript.trim()) {
    return { lines: originalLines, matched: 0, filled: 0, total, strategy: 'none' };
  }

  const diacLines = diacritizedTranscript.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  if (diacLines.length === originalLines.length) {
    let matched = 0;
    let filled = 0;
    const lines = originalLines.map((orig, i) => {
      const res = overlayLineByWord(orig, diacLines[i]);
      matched += res.matched;
      filled += res.filled;
      return res.line;
    });
    return { lines, matched, filled, total, strategy: 'per-line' };
  }

  // Counts disagree: walk the whole output as one stream.
  const stream = diacLines.join(' ').split(/\s+/).filter(Boolean);
  let cursor = 0;
  let matched = 0;
  let filled = 0;

  const lines = originalLines.map((orig) => {
    const out = orig.split(/\s+/).filter(Boolean).map((ow) => {
      // Look a little way ahead for this word — the diacritizer may have split
      // or merged a token just before it.
      let hit = -1;
      for (let k = 0; k < 4 && cursor + k < stream.length; k++) {
        if (sameWord(stream[cursor + k], ow)) { hit = cursor + k; break; }
      }
      if (hit < 0) {
        // Not found. Advance by one anyway: the overwhelmingly common cause is
        // a word the diacritizer respelled beyond recognition, which still
        // occupies one slot. Holding the cursor here is what used to desync
        // the rest of the transcript.
        if (cursor < stream.length) cursor++;
        return ow;
      }
      matched++;
      cursor = hit + 1;
      const merged = mergeWord(ow, stream[hit]);
      if (merged !== ow) filled++;
      return merged;
    });
    return out.join(' ');
  });

  return { lines, matched, filled, total, strategy: 'word-stream' };
}

/** How many consecutive diacritized tokens may be joined to match one word. */
const MAX_JOIN = 3;

/**
 * Overlay a single line, position by position with a small lookahead.
 *
 * A word is matched against the token at the cursor, and also against joins of
 * the next two or three tokens. Farasa's family of endpoints does not agree on
 * tokenisation: the segmenting ones split clitics off ("والكتاب" comes back as
 * "و+ال+كتاب", and on some deployments as three space-separated pieces), so
 * one input word can correspond to several output tokens. Comparing one to one
 * scores every such word a miss — which is what a whole transcript matching
 * exactly zero words looks like.
 */
export function overlayLineByWord(
  orig: string,
  diac: string,
): { line: string; matched: number; filled: number } {
  const origWords = orig.split(/\s+/).filter(Boolean);
  const diacWords = diac.split(/\s+/).filter(Boolean);
  let matched = 0;
  let filled = 0;
  let cursor = 0;

  const out = origWords.map((ow) => {
    // hit = index of the first token of the match, span = how many it covers.
    let hit = -1;
    let span = 1;
    search:
    for (let k = 0; k < 3 && cursor + k < diacWords.length; k++) {
      for (let n = 1; n <= MAX_JOIN && cursor + k + n <= diacWords.length; n++) {
        const piece = diacWords.slice(cursor + k, cursor + k + n).join('');
        if (sameWord(piece, ow)) { hit = cursor + k; span = n; break search; }
      }
    }
    if (hit < 0) {
      if (cursor < diacWords.length) cursor++;
      return ow;
    }
    matched++;
    cursor = hit + span;
    const merged = mergeWord(ow, diacWords.slice(hit, hit + span).join(''));
    if (merged !== ow) filled++;
    return merged;
  });

  return { line: out.join(' '), matched, filled };
}

/**
 * Overlay diacritized text that is already aligned to the lines, one to one.
 *
 * This is the path to prefer. When each line was diacritized by its own request,
 * output `i` belongs to input `i` by construction and there is no stream to walk
 * — the failure mode that produced "0/143 words located" cannot arise. A null
 * entry means that line's request failed and it keeps its original text.
 */
export function overlayDiacritizedPerLine(
  originalLines: string[],
  diacritizedLines: (string | null)[],
): OverlayResult {
  const total = originalLines.reduce(
    (n, l) => n + l.split(/\s+/).filter(Boolean).length,
    0,
  );
  let matched = 0;
  let filled = 0;

  const lines = originalLines.map((orig, i) => {
    const diac = diacritizedLines[i];
    if (!diac || !diac.trim()) return orig;
    const res = overlayLineByWord(orig, diac);
    matched += res.matched;
    filled += res.filled;
    return res.line;
  });

  return { lines, matched, filled, total, strategy: 'per-line' };
}
