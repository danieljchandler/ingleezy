// Pure half of transcript-correction capture: given the lines a video had and
// the lines an editor is about to save, find what the human actually changed.
// Free of Deno globals so the Vitest suite covers it
// (src/test/transcriptDiffCore.test.ts); the IO lives in
// supabase/functions/record-transcript-corrections.
//
// Every changed line is one training pair: the stored text (the machine's
// output, until a human first touches it) against the edited text, aligned to
// the line's audio span. This is the flywheel's "hours of audio" source —
// before it existed, the editor's work was applied destructively and the
// correction signal evaporated on save.

export interface TranscriptLineLike {
  id?: unknown;
  arabic?: unknown;
  translation?: unknown;
  startMs?: unknown;
  endMs?: unknown;
}

export interface CorrectionPair {
  kind: "asr" | "translation";
  before: string;
  after: string;
  startMs: number | null;
  endMs: number | null;
  /** The line's other half, for context (translation on asr pairs, arabic on translation pairs). */
  counterpart: string | null;
}

/** More pairs than this in one save means a regeneration, not an edit session. */
export const MAX_PAIRS_PER_SAVE = 200;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

/** Whitespace-insensitive equality — reflowing a line is not a correction. */
function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ") === b.replace(/\s+/g, " ");
}

function keyOf(line: TranscriptLineLike): string | null {
  const id = str(line.id);
  if (id) return `id:${id}`;
  const start = num(line.startMs);
  return start !== null ? `t:${start}` : null;
}

/**
 * Diff stored lines against edited lines, pairing by line id first and start
 * time second. Lines that appear or disappear entirely (splits, merges,
 * deletions) yield no pair — with no stable identity there is no before/after
 * to claim, and a wrong pairing is worse training data than none.
 */
export function diffTranscriptLines(
  oldLines: unknown,
  newLines: unknown,
  maxPairs: number = MAX_PAIRS_PER_SAVE,
): CorrectionPair[] {
  if (!Array.isArray(oldLines) || !Array.isArray(newLines)) return [];

  const oldByKey = new Map<string, TranscriptLineLike>();
  for (const raw of oldLines) {
    const line = raw as TranscriptLineLike;
    const key = keyOf(line);
    // First occurrence wins: duplicate keys mean the identity is unreliable,
    // and pairing against the wrong twin fabricates a correction.
    if (key && !oldByKey.has(key)) oldByKey.set(key, line);
  }

  const pairs: CorrectionPair[] = [];
  for (const raw of newLines) {
    if (pairs.length >= maxPairs) break;
    const line = raw as TranscriptLineLike;
    const key = keyOf(line);
    if (!key) continue;
    const prior = oldByKey.get(key);
    if (!prior) continue;

    const beforeArabic = str(prior.arabic);
    const afterArabic = str(line.arabic);
    if (beforeArabic && afterArabic && !sameText(beforeArabic, afterArabic)) {
      pairs.push({
        kind: "asr",
        before: beforeArabic,
        after: afterArabic,
        startMs: num(line.startMs) ?? num(prior.startMs),
        endMs: num(line.endMs) ?? num(prior.endMs),
        counterpart: str(line.translation) || null,
      });
      if (pairs.length >= maxPairs) break;
    }

    const beforeEn = str(prior.translation);
    const afterEn = str(line.translation);
    if (beforeEn && afterEn && !sameText(beforeEn, afterEn)) {
      pairs.push({
        kind: "translation",
        before: beforeEn,
        after: afterEn,
        startMs: num(line.startMs) ?? num(prior.startMs),
        endMs: num(line.endMs) ?? num(prior.endMs),
        counterpart: afterArabic || beforeArabic || null,
      });
    }
  }
  return pairs;
}

/**
 * Collapse the app's regional dialect labels onto the three training dialects.
 * Returns null for anything unrecognised — a skipped row beats a mislabeled
 * one.
 */
export function normalizeDialect(value: unknown): "Gulf" | "Egyptian" | "Yemeni" | null {
  const v = str(value);
  if (v === "Gulf" || v === "Egyptian" || v === "Yemeni") return v;
  if (["Saudi", "Kuwaiti", "UAE", "Bahraini", "Qatari", "Omani", "Emirati"].includes(v)) {
    return "Gulf";
  }
  return null;
}
