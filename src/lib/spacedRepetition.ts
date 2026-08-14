/**
 * FSRS-4.5 Spaced Repetition Algorithm
 *
 * Free Spaced Repetition Scheduler v4.5 — the algorithm used by Anki since
 * version 23.10. Substantially outperforms SM-2 (89.6% vs 47.1% success rate
 * in head-to-head benchmarks).
 *
 * Key differences from SM-2:
 *   - Uses stability (S) instead of ease factor: S = days until 90% retention
 *   - Uses difficulty (D, 1–10) to modulate stability growth
 *   - Forgetting curve: R(t,S) = (1 + FACTOR × t/S)^DECAY
 *   - Stability after recall grows based on current difficulty + retrievability
 *   - Stability after forgetting uses a separate formula (not just "reset")
 *
 * State stored per card:
 *   ease_factor  → stability S (days to 90% retention)
 *   difficulty   → difficulty D (1–10, new column)
 *   interval_days → last scheduled interval (rounded stability)
 *   repetitions  → number of completed reviews
 *
 * Reference: https://github.com/open-spaced-repetition/fsrs4anki
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewResult {
  /** FSRS stability — days until retention drops to 90%. Stored in ease_factor column. */
  stability: number;
  /** FSRS difficulty — 1 (easiest) to 10 (hardest). Stored in difficulty column. */
  difficulty: number;
  intervalDays: number;
  repetitions: number;
  nextReviewAt: Date;
}

// ── FSRS-4.5 default parameters ───────────────────────────────────────────────
// Trained on 20k+ Anki users. Can be personalised per-user with optimizer;
// these defaults work well for most learners.
const W = [
  0.4072,  // w0:  S₀ for Again
  1.1829,  // w1:  S₀ for Hard
  3.1262,  // w2:  S₀ for Good
  15.4722, // w3:  S₀ for Easy
  7.2102,  // w4:  D₀ base
  0.5316,  // w5:  D₀ exponent
  1.0651,  // w6:  difficulty delta weight
  0.0589,  // w7:  difficulty mean-reversion weight
  1.5330,  // w8:  recall stability: base exponent
  0.1544,  // w9:  recall stability: S^(-w9)
  0.9009,  // w10: recall stability: R factor
  1.9330,  // w11: forget stability: multiplier
  0.1100,  // w12: forget stability: D^(-w12)
  0.2900,  // w13: forget stability: (S+1)^w13
  2.2700,  // w14: forget stability: R factor
  0.1500,  // w15: Hard penalty
  2.9898,  // w16: Easy bonus
];

const DECAY  = -0.5;
const FACTOR = 19 / 81; // ≈ 0.2346 — derived from DECAY and 90% retention target

// ── Personalisation options ───────────────────────────────────────────────────

export interface ScheduleOptions {
  /**
   * Target recall probability at review time. FSRS stores stability as "days
   * until retention drops to 90%"; the forgetting curve converts it to an
   * interval for any other target: t = S × (R^(1/DECAY) − 1) / FACTOR.
   * 0.9 (the default) leaves intervals exactly as before; lower means fewer,
   * longer reviews with more forgetting; higher means the reverse. Clamped to
   * [0.7, 0.97] — outside that the curve asks for absurd intervals.
   */
  desiredRetention?: number;
  /**
   * When set (any stable per-card string — the card id), intervals of 3+ days
   * get a deterministic ±5% fuzz so cards created or imported together don't
   * all land due on the same future day. Deterministic per (card, interval):
   * the same rating previewed twice or applied after a preview yields the
   * same number. Absent = no fuzz, which keeps historical behaviour.
   */
  fuzzSeed?: string;
}

/** Interval multiplier for a desired retention; 1.0 at the 90% default. */
export function retentionFactor(desiredRetention: number | undefined): number {
  const r = Math.min(0.97, Math.max(0.7, desiredRetention ?? 0.9));
  return (Math.pow(r, 1 / DECAY) - 1) / FACTOR;
}

/** Deterministic hash → [-1, 1), stable across sessions. */
function fuzzUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map the 32-bit hash onto [-1, 1).
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/**
 * ±5% load-balancing fuzz for day-scale intervals. Sub-3-day intervals are
 * left exact — learning steps are meant to be precise — and the result never
 * drops below 2 days so fuzz can't demote a graduated card back to tomorrow.
 */
export function fuzzInterval(intervalDays: number, seed: string | undefined): number {
  if (!seed || intervalDays < 3) return intervalDays;
  const delta = Math.round(intervalDays * 0.05 * fuzzUnit(`${seed}:${intervalDays}`));
  return Math.max(2, intervalDays + delta);
}

// ── Rating → integer (FSRS uses 1-4) ─────────────────────────────────────────
const RATING_NUM: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

// ── Core formulas ─────────────────────────────────────────────────────────────

/** Probability of recall after `elapsed` days given stability `s`. */
function retrievability(elapsed: number, s: number): number {
  return Math.pow(1 + FACTOR * Math.max(elapsed, 0) / s, DECAY);
}

/** Initial stability for a brand-new card. */
function initStability(r: number): number {
  return Math.max(W[r - 1], 0.1);
}

/** Initial difficulty (1–10) for a brand-new card. */
function initDifficulty(r: number): number {
  return clampD(W[4] - Math.exp(W[5] * (r - 1)) + 1);
}

function clampD(d: number): number {
  return Math.min(10, Math.max(1, d));
}

/** Next difficulty after a review — mean-reverts toward the "Easy" baseline. */
function nextDifficulty(d: number, r: number): number {
  const delta = d - W[6] * (r - 3);
  // Mean-revert toward D₀(Easy=4) so difficulty can't drift too far
  return clampD(W[7] * initDifficulty(4) + (1 - W[7]) * delta);
}

/** Stability after a successful recall (Hard/Good/Easy). */
function nextRecallStability(d: number, s: number, r: number, rating: number): number {
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus   = rating === 4 ? W[16] : 1;
  return s * (
    Math.exp(W[8]) *
    (11 - d) *
    Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus
    + 1
  );
}

/** Stability after forgetting (Again). Lower than before but not zero. */
function nextForgetStability(d: number, s: number, r: number): number {
  return (
    W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp(W[14] * (1 - r))
  );
}

// ── Short learning intervals ──────────────────────────────────────────────────
const LEARNING_INTERVALS: Record<Rating, number> = {
  again: 1 / 1440,  // 1 minute
  hard:  5 / 1440,  // 5 minutes
  good:  10 / 1440, // 10 minutes (only used if stability < 1)
  easy:  1,         // 1 day minimum
};

// ── Main scheduling function ──────────────────────────────────────────────────

/**
 * Calculate the next review schedule using FSRS-4.5.
 *
 * @param rating     User's recall rating
 * @param stability  Current stability S (stored in ease_factor column). 0 for new cards.
 * @param difficulty Current difficulty D (stored in difficulty column). 5 for new cards.
 * @param intervalDays  Last scheduled interval in days (fallback elapsed proxy)
 * @param repetitions   Number of completed reviews so far
 * @param elapsedDays   Actual days since the last review (from last_reviewed_at).
 *                      When supplied, FSRS retrievability is measured at the real
 *                      review moment instead of assuming the card was reviewed on
 *                      schedule — so overdue reviews are no longer mis-estimated.
 *                      Compute it with {@link elapsedDaysSince}.
 */
export function calculateNextReview(
  rating: Rating,
  stability: number,
  difficulty: number,
  intervalDays: number,
  repetitions: number,
  elapsedDays?: number,
  options?: ScheduleOptions,
): ReviewResult {
  const r = RATING_NUM[rating];
  const isNewCard = repetitions === 0 || stability <= 0;
  const intervalFactor = retentionFactor(options?.desiredRetention);

  let newStability: number;
  let newDifficulty: number;
  let newInterval: number;
  let newRepetitions: number;

  if (isNewCard) {
    // ── First exposure ──────────────────────────────────────────────────────
    newStability  = initStability(r);
    newDifficulty = initDifficulty(r);

    if (rating === 'again' || rating === 'hard') {
      newInterval   = LEARNING_INTERVALS[rating];
      newRepetitions = 0; // still in learning phase
    } else {
      // Good/Easy: graduate to review
      newInterval    = Math.max(rating === 'easy' ? 4 : 1, Math.round(newStability * intervalFactor));
      newRepetitions = 1;
    }
  } else {
    // ── Established card ────────────────────────────────────────────────────
    const s = stability;
    const d = difficulty > 0 ? difficulty : 5.0;
    // Prefer real elapsed time (from last_reviewed_at) when the caller supplies
    // it; fall back to the scheduled interval only when it's unknown. A card
    // reviewed on the day it's due gives elapsed ≈ interval (unchanged
    // behaviour); a card reviewed late now correctly lowers retrievability.
    const elapsed = elapsedDays != null
      ? Math.max(elapsedDays, 0)
      : Math.max(intervalDays, 1);
    const ret = retrievability(elapsed, s);

    newDifficulty = nextDifficulty(d, r);

    if (rating === 'again') {
      // Forgot — shorter interval, lower stability but not zero
      // Keep repetitions > 0 so a lapsed established card is not re-treated as brand-new
      newStability   = Math.max(nextForgetStability(d, s, ret), 0.1);
      newInterval    = LEARNING_INTERVALS.again;
      newRepetitions = repetitions;
    } else {
      // Recalled — stability grows; the interval is the stability scaled to
      // the learner's retention target (identical at the 90% default).
      newStability   = Math.max(nextRecallStability(d, s, ret, r), 0.1);
      newInterval    = Math.round(newStability * intervalFactor);
      newRepetitions = repetitions + 1;
    }
  }

  // Sub-day intervals keep minute precision; day+ intervals are whole days
  if (newInterval >= 1) {
    newInterval = Math.max(1, Math.round(newInterval));
    newInterval = fuzzInterval(newInterval, options?.fuzzSeed);
  }

  const nextReviewAt = new Date();
  nextReviewAt.setTime(nextReviewAt.getTime() + newInterval * 24 * 60 * 60 * 1000);

  return {
    stability:    Math.round(newStability   * 10000) / 10000,
    difficulty:   Math.round(newDifficulty  * 10000) / 10000,
    intervalDays: newInterval,
    repetitions:  newRepetitions,
    nextReviewAt,
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function getIntervalDisplay(intervalDays: number): string {
  // Arabic single-letter units: د دقيقة · س ساعة · ي يوم · ش شهر
  if (intervalDays < 1 / 60) {
    return '< 1د';
  } else if (intervalDays < 1 / 24) {
    const minutes = Math.round(intervalDays * 24 * 60);
    return `${minutes}د`;
  } else if (intervalDays < 1) {
    const hours = Math.round(intervalDays * 24);
    return `${hours}س`;
  } else if (intervalDays < 30) {
    return `${Math.round(intervalDays)}ي`;
  } else if (intervalDays < 365) {
    return `${Math.round(intervalDays / 30)}ش`;
  } else {
    return `${Math.round(intervalDays / 365 * 10) / 10}سنة`;
  }
}

export function estimateNextInterval(
  rating: Rating,
  stability: number,
  difficulty: number,
  intervalDays: number,
  repetitions: number,
  elapsedDays?: number,
  options?: ScheduleOptions,
): string {
  const result = calculateNextReview(rating, stability, difficulty, intervalDays, repetitions, elapsedDays, options);
  return getIntervalDisplay(result.intervalDays);
}

/**
 * Days elapsed since an ISO timestamp, for feeding real elapsed time into
 * {@link calculateNextReview}. Returns undefined when no usable timestamp is
 * available (e.g. a never-reviewed card), so the scheduler falls back to the
 * scheduled interval.
 */
export function elapsedDaysSince(lastReviewedAt: string | null | undefined): number | undefined {
  if (!lastReviewedAt) return undefined;
  const then = new Date(lastReviewedAt).getTime();
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, (Date.now() - then) / (24 * 60 * 60 * 1000));
}
