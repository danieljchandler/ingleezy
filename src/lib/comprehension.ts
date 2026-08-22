/**
 * Transcript-level comprehension: what fraction of a video's actual ENGLISH
 * words does this learner already know?
 *
 * The research consensus behind comprehensible input is that learners progress
 * fastest on material where they know the large majority of the words. The
 * app is unusually well placed to compute that — it owns the transcripts and
 * knows the learner's vocabulary from real SRS state.
 *
 * The measured language is the English line (`line.english`) — the input the
 * learner is acquiring. The Arabic on these transcripts is the scaffold
 * translation, and a native Arabic speaker's coverage of it is always ~100%
 * and means nothing. Bridged Hakiya clips have no English lines at all, so
 * they get no bar rather than a bar built on the wrong language.
 *
 * Everything here is pure and runs client-side: transcripts arrive with the
 * Discover feed and the learner's decks are already in the react-query cache,
 * so coverage costs no network at all. (The server-side rule — never trust a
 * client-supplied "words I know" list — is about prompts to generators; this
 * is display, computed from the same rows the server would read.)
 *
 * Function words (the, of, is, …) count as known: they are acquired almost
 * immediately and carry no lexical load, and without that assumption every
 * beginner would see 5% on everything. Light suffix stripping lets a saved
 * base form claim its inflections (want → wants/wanted/wanting) without
 * pretending to be a lemmatiser.
 */

export type ComprehensionBand = "comfortable" | "stretch" | "challenge";

export interface Comprehension {
  /** 0..1 — fraction of transcript tokens the learner knows. */
  coverage: number;
  band: ComprehensionBand;
  totalTokens: number;
  unknownTokens: number;
}

/** Below this many countable tokens, a percentage is noise, not signal. */
export const MIN_TOKENS = 20;

/** A learner with fewer saved words than this has no meaningful "known" set. */
export const MIN_KNOWN_WORDS = 10;

/**
 * The English closed class: articles, pronouns, auxiliaries, prepositions,
 * conjunctions, common adverbial particles. A learner "knows" these
 * implicitly within their first weeks; counting them unknown would drown the
 * signal for exactly the beginners the bands exist to protect.
 */
const FUNCTION_WORDS = new Set([
  "a", "an", "the",
  "i", "you", "he", "she", "it", "we", "they",
  "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "mine", "yours",
  "this", "that", "these", "those", "there", "here",
  "am", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had",
  "will", "would", "can", "could", "shall", "should", "may", "might", "must",
  "not", "no", "yes", "dont", "cant", "wont", "im", "its", "thats", "isnt",
  "and", "or", "but", "so", "if", "then", "than", "because",
  "of", "to", "in", "on", "at", "for", "with", "by", "from", "up", "down",
  "out", "off", "over", "under", "into", "about", "as", "like",
  "what", "who", "when", "where", "why", "how", "which",
  "just", "very", "too", "also", "now", "well", "oh", "okay", "ok", "one",
]);

const LATIN_LETTER = /[a-z]/;

/**
 * Split a run of text into normalized English tokens worth counting.
 * Apostrophes fold away rather than split ("don't" → "dont"), so a
 * contraction stays one token and matches the stoplist's folded forms.
 */
export function tokenizeEnglish(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && LATIN_LETTER.test(t));
}

/**
 * The learner's known-token set from their saved words and phrases. A
 * multi-word entry contributes every content token — saving a phrase means
 * having met each of its words.
 */
export function buildKnownTokenSet(entries: Array<string | null | undefined>): Set<string> {
  const known = new Set<string>();
  for (const entry of entries) {
    if (!entry) continue;
    for (const token of tokenizeEnglish(entry)) known.add(token);
  }
  return known;
}

/**
 * A token counts as known if the learner saved it, it's a function word, or
 * it reduces to a known base once a common suffix comes off — the inflections
 * that most often hide a known word (wants/wanted/wanting vs want, makes vs
 * make). Suffix stripping is deliberately shallow: guessing wrong here shows
 * a learner an inflated bar, which is worse than a shy one.
 */
function isKnown(token: string, known: Set<string>): boolean {
  if (known.has(token) || FUNCTION_WORDS.has(token)) return true;
  const candidates: string[] = [];
  if (token.endsWith("s") && token.length > 3) candidates.push(token.slice(0, -1));
  if (token.endsWith("es") && token.length > 4) candidates.push(token.slice(0, -2));
  if (token.endsWith("ed") && token.length > 4) {
    candidates.push(token.slice(0, -2), token.slice(0, -1)); // wanted→want, liked→like
  }
  if (token.endsWith("ing") && token.length > 5) {
    candidates.push(token.slice(0, -3), token.slice(0, -3) + "e"); // going→go, making→make
  }
  return candidates.some((c) => known.has(c));
}

/**
 * Coverage of a video's ENGLISH transcript lines against a known-token set.
 * Returns null when there is no usable English transcript — bridged Arabic
 * clips and text-overlay-only videos get no bar rather than a wrong one.
 */
export function transcriptComprehension(
  lines: unknown,
  known: Set<string>,
): Comprehension | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;

  let total = 0;
  let unknown = 0;
  for (const raw of lines) {
    const english = (raw as { english?: unknown } | null)?.english;
    if (typeof english !== "string") continue;
    for (const token of tokenizeEnglish(english)) {
      total++;
      if (!isKnown(token, known)) unknown++;
    }
  }
  if (total < MIN_TOKENS) return null;

  const coverage = (total - unknown) / total;
  return { coverage, band: comprehensionBand(coverage), totalTokens: total, unknownTokens: unknown };
}

/**
 * The i+1 bands: ≥90% known reads comfortably, 70–90% is the productive
 * stretch zone where new words have enough context to stick, under 70% is a
 * wall.
 */
export function comprehensionBand(coverage: number): ComprehensionBand {
  if (coverage >= 0.9) return "comfortable";
  if (coverage >= 0.7) return "stretch";
  return "challenge";
}

/** Tailwind classes for the coverage bar, one tone per band. */
export function comprehensionBarClass(band: ComprehensionBand): string {
  switch (band) {
    case "comfortable":
      return "bg-emerald-500";
    case "stretch":
      return "bg-amber-500";
    case "challenge":
      return "bg-rose-500";
  }
}

/** Short label for the badge and the filter chip. */
export function comprehensionLabel(band: ComprehensionBand): string {
  switch (band) {
    case "comfortable":
      return "مريح";
    case "stretch":
      return "مناسب تماماً";
    case "challenge":
      return "صعب";
  }
}
