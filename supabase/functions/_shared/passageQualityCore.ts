// Pure quality checks for generated reading passages.
//
// This exists as its own dependency-free module for the same reason
// learnerProfileCore.ts does: it is the logic that decides whether a draft is
// finished, and it needs to be unit-testable from the frontend Vitest suite
// rather than only exercisable by making a live model call.
//
// The gate below is what lets reading-passage skip the draft_critic critic
// pass. That pass re-generates the entire payload — the most expensive step in
// the pipeline — and used to run on every single request. Its job is to make
// sure the learner gets complete, vocalized, fully translated output; this
// module answers that question locally in microseconds, so the rewrite only
// runs when something is actually missing.

// =================== Tashkeel measurement ===================

// Arabic diacritics (tashkeel) Unicode range: U+064B – U+065F + U+0670
const TASHKEEL_RE = /[\u064B-\u065F\u0670]/;
// Arabic base consonant/letter range. Non-global so per-character `.test()` is stateless.
const ARABIC_LETTER_RE = /[\u0621-\u064A]/;
const ARABIC_LETTER_RE_G = /[\u0621-\u064A]/g;

/**
 * Measure what fraction of Arabic letters have an adjacent diacritic (tashkeel).
 * Returns a ratio between 0.0 (no tashkeel) and 1.0 (fully vocalized).
 *
 * Note that 1.0 is not reachable in practice: long vowels and word-final letters
 * legitimately carry no diacritic, so genuinely vocalized prose lands around
 * 0.6–0.8. Thresholds must be set against that ceiling, not against 1.0.
 */
export function measureTashkeelCoverage(text: string): number {
  if (!text) return 0;
  const letters = text.match(ARABIC_LETTER_RE_G);
  if (!letters || letters.length === 0) return 0;

  let vocalized = 0;
  for (let i = 0; i < text.length; i++) {
    if (ARABIC_LETTER_RE.test(text[i])) {
      if (i + 1 < text.length && TASHKEEL_RE.test(text[i + 1])) {
        vocalized++;
      }
    }
  }
  return vocalized / letters.length;
}

// =================== Reading passage gate ===================

/**
 * Floor for accepting a draft as vocalized.
 *
 * Deliberately lower than the 0.7 threshold generate-listen-script uses. That
 * one gates a cheap, targeted tashkeel-only pass, so it can afford to be picky;
 * this one gates a full rewrite of the whole passage, so it should only fire on
 * output that is essentially unvocalized rather than merely imperfect.
 */
export const TASHKEEL_FLOOR = 0.45;

/** Loose shape of a model draft. Every field is unknown until checked. */
interface DraftLine {
  arabic?: unknown;
  english?: unknown;
  transliteration?: unknown;
  literal?: unknown;
}
interface DraftOption { correct?: unknown }
interface DraftQuestion { options?: unknown }
interface DraftPassage {
  title?: unknown;
  lines?: unknown;
  vocabulary?: unknown;
  questions?: unknown;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Decide whether a reading-passage draft is complete enough to ship as-is.
 *
 * Returns null when the draft is finished, or a short human-readable reason
 * when it needs the critic/rewrite pass. The checks mirror exactly what the UI
 * renders and what the learner was promised: every line vocalized, with a
 * transliteration, a natural translation and a literal gloss; plus vocabulary
 * and an answerable comprehension quiz.
 */
export function readingPassageGate(
  parsed: unknown,
  opts: { minLines?: number } = {},
): string | null {
  const minLines = Math.max(1, opts.minLines ?? 1);
  const p = (parsed ?? {}) as DraftPassage;
  if (!nonEmpty(p.title)) return "missing title";

  const lines = Array.isArray(p.lines) ? (p.lines as DraftLine[]) : [];
  if (lines.length === 0) return "no lines";
  // A passage short of its difficulty's length isn't a story. This has to be a
  // gate failure rather than a warning: it is the only thing that sends a
  // two-sentence "intermediate" draft back for a rewrite.
  if (lines.length < minLines) return `too short: ${lines.length} lines, need ${minLines}`;
  for (const l of lines) {
    if (!nonEmpty(l?.arabic)) return "line missing arabic";
    if (!nonEmpty(l?.english)) return "line missing translation";
    if (!nonEmpty(l?.transliteration)) return "line missing transliteration";
    if (!nonEmpty(l?.literal)) return "line missing literal gloss";
  }

  if (!Array.isArray(p.vocabulary) || p.vocabulary.length === 0) return "no vocabulary";

  const questions = Array.isArray(p.questions) ? (p.questions as DraftQuestion[]) : [];
  if (questions.length === 0) return "no questions";
  for (const q of questions) {
    const options = Array.isArray(q?.options) ? (q.options as DraftOption[]) : [];
    if (options.length < 2) return "question missing options";
    if (!options.some((o) => o?.correct === true)) return "question has no correct answer";
  }

  const arabic = [p.title, ...lines.map((l) => l.arabic)].filter(nonEmpty).join(" ");
  const coverage = measureTashkeelCoverage(arabic);
  if (coverage < TASHKEEL_FLOOR) return `tashkeel coverage ${coverage.toFixed(2)}`;

  return null;
}
