/**
 * Transcript-level comprehension: what fraction of a video's actual words does
 * this learner already know?
 *
 * The research consensus behind comprehensible input is that learners progress
 * fastest on material where they know the large majority of the words. The
 * app is unusually well placed to compute that — it owns the transcripts and
 * knows the learner's vocabulary from real SRS state — but until now nothing
 * did: the feed's comprehension score samples only a video's 5–15 curated
 * highlight words, and the browse tab had no signal at all.
 *
 * Everything here is pure and runs client-side: transcripts arrive with the
 * Discover feed and the learner's decks are already in the react-query cache,
 * so coverage costs no network at all. (The server-side rule — never trust a
 * client-supplied "words I know" list — is about prompts to generators; this
 * is display, computed from the same rows the server would read.)
 *
 * Token matching reuses the dialect machinery's Arabic normalization and its
 * per-dialect function-word lists (ALWAYS_ALLOWED): a learner "knows"
 * particles like في and انا implicitly, and without that assumption every
 * beginner would see 5% on everything.
 */
import {
  ALWAYS_ALLOWED,
  normalizeArabic,
} from "../../supabase/functions/_shared/msaLeakDetector";

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

// Arabic LETTERS only — the broad Arabic block also contains punctuation
// (، ؟ ؛) and digits, which must split tokens, not ride along inside them.
const ARABIC_LETTER = /[ء-يٱ-ۓ]/;
const NON_LETTER = /[^ء-يٱ-ۓ]+/g;

/** Split a run of text into normalized Arabic tokens worth counting. */
export function tokenizeArabic(text: string): string[] {
  if (!text) return [];
  return normalizeArabic(text)
    .split(NON_LETTER)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && ARABIC_LETTER.test(t));
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
    for (const token of tokenizeArabic(entry)) known.add(token);
  }
  return known;
}

/**
 * A token counts as known if the learner saved it, it's a dialect function
 * word, or it reduces to a known form once the definite article or the
 * و-conjunction prefix is stripped — the two clitics that most often hide a
 * known word (البيت vs بيت, وقال vs قال).
 */
function isKnown(token: string, known: Set<string>, functionWords: Set<string>): boolean {
  if (known.has(token) || functionWords.has(token)) return true;
  const candidates: string[] = [];
  if (token.startsWith("ال") && token.length > 3) candidates.push(token.slice(2));
  if (token.startsWith("و") && token.length > 2) {
    candidates.push(token.slice(1));
    if (token.startsWith("وال") && token.length > 4) candidates.push(token.slice(3));
  }
  return candidates.some((c) => known.has(c) || functionWords.has(c));
}

/**
 * Coverage of a video's transcript lines against a known-token set. Returns
 * null when there is no usable transcript — a card without a bar beats a bar
 * built on noise.
 */
export function transcriptComprehension(
  lines: unknown,
  known: Set<string>,
  dialect: string | null | undefined,
): Comprehension | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const functionWords: Set<string> =
    ALWAYS_ALLOWED[dialect ?? ""] ?? ALWAYS_ALLOWED.Gulf;

  let total = 0;
  let unknown = 0;
  for (const raw of lines) {
    const arabic = (raw as { arabic?: unknown } | null)?.arabic;
    if (typeof arabic !== "string") continue;
    for (const token of tokenizeArabic(arabic)) {
      total++;
      if (!isKnown(token, known, functionWords)) unknown++;
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
