// =============================================================================
// Token-overlap similarity, and using a third-party rendering to settle a
// disputed line.
//
// The translation ensemble clusters Gemini/Claude/Qwen by Jaccard overlap and
// flags a line `needs_review` when no cluster reaches a winning weight. The
// Shaheen-MT tiebreak was then asked for a rendering of exactly those lines —
// and did nothing with it: an already-populated line kept the ensemble's text,
// carried Shaheen's as `altTranslation`, and stayed flagged. Every audit read
// the same way: "tiebreak fired, filled 0 disputes", because `filled` only ever
// counted lines the ensemble had left *empty*.
//
// A tiebreak that cannot break a tie is just an extra API call. Shaheen is an
// Arabic-native dedicated MT model, so when its rendering clearly backs one of
// the disputed candidates, that is a real vote — enough to settle the line.
// =============================================================================

export function normalizeForCompare(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}…—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set overlap of two strings, 0..1. */
export function jaccard(a: string, b: string): number {
  return jaccardOfSets(
    new Set(normalizeForCompare(a).split(' ').filter(Boolean)),
    new Set(normalizeForCompare(b).split(' ').filter(Boolean)),
  );
}

function jaccardOfSets(ta: Set<string>, tb: Set<string>): number {
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Function words carry no meaning to compare on, and every English translation
 * of anything contains most of them. Leaving them in compresses the range: two
 * translations that share nothing but "the/to/a" still score well above zero,
 * and two that agree completely score barely higher than two that don't.
 * Dropping them is what makes the comparison discriminate.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'so', 'than', 'then', 'that',
  'this', 'these', 'those', 'is', 'am', 'are', 'was', 'were', 'be', 'been',
  'being', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'shall',
  'should', 'can', 'could', 'may', 'might', 'must', 'of', 'in', 'on', 'at',
  'to', 'for', 'with', 'from', 'by', 'as', 'into', 'about', 'up', 'down',
  'out', 'over', 'it', 'its', 'i', 'you', 'he', 'she', 'they', 'we', 'me',
  'him', 'her', 'them', 'us', 'my', 'your', 'his', 'their', 'our', 'there',
  'here', 'not', 'no', 'very', 'just', 'also', 's', 't',
]);

export function contentTokens(text: string): Set<string> {
  return new Set(
    normalizeForCompare(text).split(' ').filter((w) => w && !STOPWORDS.has(w)),
  );
}

/**
 * Overlap of the meaning-bearing words only.
 *
 * Falls back to plain token overlap when either side is all function words —
 * a three-word line can legitimately have no content tokens, and scoring that
 * zero would look like disagreement.
 */
export function contentSimilarity(a: string, b: string): number {
  const ca = contentTokens(a);
  const cb = contentTokens(b);
  if (ca.size === 0 || cb.size === 0) return jaccard(a, b);
  return jaccardOfSets(ca, cb);
}

export interface ArbiterCandidate {
  name: string;
  weight: number;
  text: string;
  literal: string;
}

export interface Arbitration {
  /** The candidate the arbiter's rendering backs, or null when it backs none. */
  winner: ArbiterCandidate | null;
  /** Overlap between the winner and the arbiter's text. */
  score: number;
  /** How far ahead of the runner-up the winner is. 0 when it stands alone. */
  margin: number;
  /**
   * How the winner was chosen.
   * `nearest` — the arbiter is clearly closer to this candidate than the rest.
   * `corroborated` — the arbiter backs several candidates comparably well, so
   *   the line is not a quality risk and the highest-weight model takes it.
   */
  mode?: 'nearest' | 'corroborated';
  /** Why no winner was chosen, for provenance. */
  reason?: 'no_arbiter_text' | 'no_candidates' | 'below_threshold' | 'too_close';
}

/**
 * Noise floor. Below this the arbiter and the candidate share essentially
 * nothing, and whichever scored higher did so by accident.
 *
 * Deliberately low. A dedicated MT model and an LLM translating the same
 * sentence pick different words for the same meaning — "he went to the market"
 * against "he headed to the shop" shares one content word in five — so an
 * absolute bar set where two texts look *alike* is a bar almost nothing clears.
 * Three consecutive audits resolved 0 disputed lines against a 0.45 bar. What
 * a tiebreak actually needs is not "is this candidate close to the arbiter" but
 * "is it closer than the others", and that is a relative question; this
 * constant only rules out deciding on noise.
 */
export const ARBITER_MIN_SCORE = 0.15;

/**
 * The bar for *corroboration*, which is a different and stronger claim.
 *
 * Picking the nearer of two candidates needs only a gap. Declaring a disputed
 * line safe because the arbiter backs several candidates asserts something
 * about quality, so it keeps the high absolute bar the discrimination path gave
 * up.
 */
export const ARBITER_CORROBORATION_SCORE = 0.45;

/**
 * How far ahead the best candidate must be, as a multiple of the runner-up.
 * A ratio rather than a difference because the absolute numbers are small:
 * 0.24 against 0.10 is a decisive preference that a fixed 0.1 margin misses.
 */
export const ARBITER_MIN_RATIO = 1.5;

/**
 * How far the winner must lead the runner-up to be called the *nearest* match.
 * Below this the arbiter is not discriminating between them — which is a
 * separate question from whether either is any good; see `corroborated`.
 */
export const ARBITER_MIN_MARGIN = 0.1;

/**
 * Decide which disputed candidate an arbiter's rendering supports.
 *
 * Four audits in a row reported this resolving nothing, and the reason was the
 * question being asked. Requiring a candidate to *look like* the arbiter sets a
 * bar that translations of the same sentence by different models rarely clear:
 * a dedicated MT model and an LLM pick different words for the same meaning.
 * What a tiebreak needs to know is which candidate is *nearest*, which is a
 * relative question, so that is what the primary path now decides — on content
 * words, with a ratio, and with only a noise floor in absolute terms.
 *
 * `corroborated` is the second path and keeps the old high bar, because it makes
 * a different claim. Picking the nearer of two candidates asserts a preference;
 * clearing a disputed line because the arbiter backs several of them asserts
 * that none of them is wrong. Only the second needs the arbiter to genuinely
 * agree, so only the second requires an absolute level.
 *
 * Anything that satisfies neither stays flagged — this narrows the review queue,
 * it does not replace it.
 */
export function arbitrateDispute(
  arbiterText: string | null | undefined,
  candidates: ArbiterCandidate[],
  opts: {
    minScore?: number;
    minMargin?: number;
    minRatio?: number;
    corroborationScore?: number;
  } = {},
): Arbitration {
  const minScore = opts.minScore ?? ARBITER_MIN_SCORE;
  const minMargin = opts.minMargin ?? ARBITER_MIN_MARGIN;
  const minRatio = opts.minRatio ?? ARBITER_MIN_RATIO;
  const corroborationScore = opts.corroborationScore ?? ARBITER_CORROBORATION_SCORE;

  if (!arbiterText || !arbiterText.trim()) {
    return { winner: null, score: 0, margin: 0, reason: 'no_arbiter_text' };
  }
  const present = candidates.filter((c) => c.text && c.text.trim());
  if (present.length === 0) {
    return { winner: null, score: 0, margin: 0, reason: 'no_candidates' };
  }

  // Content words only. Comparing full token sets let the function words every
  // English sentence shares dominate the score, which is how the arbiter ended
  // up scoring every candidate alike.
  const scored = present
    .map((c) => ({ cand: c, score: contentSimilarity(arbiterText, c.text) }))
    .sort((a, b) => b.score - a.score || b.cand.weight - a.cand.weight);

  const best = scored[0];
  const runnerUp = scored[1];
  const margin = runnerUp ? best.score - runnerUp.score : best.score;

  // The arbiter backs nothing here — a real disagreement, keep it flagged.
  if (best.score < minScore) {
    return { winner: null, score: best.score, margin, reason: 'below_threshold' };
  }

  // Clearly nearer to one candidate than the rest. Either a plain gap or a
  // decisive ratio counts: at these magnitudes 0.24 against 0.10 is an obvious
  // preference that a fixed 0.1 margin would throw away.
  const dominates = !runnerUp
    || margin >= minMargin
    || (runnerUp.score > 0 ? best.score / runnerUp.score >= minRatio : true);
  if (dominates) {
    return { winner: best.cand, score: best.score, margin, mode: 'nearest' };
  }

  // Too close to call. Settling the line anyway asserts that both readings are
  // fine, which needs the arbiter to actually back them — a higher bar than
  // merely preferring one over another.
  const backed = scored.filter((s) => s.score >= corroborationScore);
  if (backed.length >= 2) {
    const winner = backed
      .slice()
      .sort((a, b) => b.cand.weight - a.cand.weight || b.score - a.score)[0];
    return { winner: winner.cand, score: best.score, margin, mode: 'corroborated' };
  }

  return { winner: null, score: best.score, margin, reason: 'too_close' };
}
