// Pure half of the concept-mastery model: the strength ladder, the scheduling
// arithmetic, and the prompt rendering.
//
// `user_concept_mastery` has existed since the curriculum-concepts migration
// (20260503134531) and has never been written to by anything. The whole
// per-learner branch of the coverage planner reads it, finds nothing, and
// silently degrades to cohort-level behaviour. The practical consequence is
// that the app tracks vocabulary in fine detail — FSRS stability per card,
// leeches, production errors — and tracks *structure* not at all. A learner who
// misses every negation question in Grammar Drills leaves no trace anywhere:
// the score is rendered once and dropped, and the next drill is generated as if
// they had never answered a question.
//
// This module is the ladder that fixes that. Deliberately dependency-free — no
// Deno globals, no esm.sh imports — so it can be unit-tested from the frontend
// Vitest suite (src/test/conceptMasteryCore.test.ts) and imported by the React
// app for display, while the IO half (conceptMastery.ts) stays a Deno module.

/** The `mastery_strength` enum, in ascending order. */
export const STRENGTH_LADDER = [
  "new",
  "learning",
  "familiar",
  "strong",
  "mastered",
] as const;

export type MasteryStrength = (typeof STRENGTH_LADDER)[number];

/** Row shape of `user_concept_mastery`, in the fields this module reasons about. */
export interface MasteryState {
  exposures: number;
  correct: number;
  incorrect: number;
  ease: number;
  strength: MasteryStrength;
}

export interface MasteryUpdate extends MasteryState {
  /** ISO timestamp; when this concept should next be re-exposed. */
  next_due_at: string;
  last_seen_at: string;
}

export const INITIAL_MASTERY: MasteryState = {
  exposures: 0,
  correct: 0,
  incorrect: 0,
  ease: 2.5,
  strength: "new",
};

/**
 * Promotion gates: to reach a strength you need both enough attempts and enough
 * accuracy. The attempt counts matter as much as the accuracy — three lucky
 * guesses out of three is not mastery of a grammar point, and without a floor
 * on exposures the ladder would hand out "mastered" on the first drill.
 */
const GATES: { strength: MasteryStrength; exposures: number; accuracy: number }[] = [
  { strength: "mastered", exposures: 12, accuracy: 0.9 },
  { strength: "strong", exposures: 8, accuracy: 0.8 },
  { strength: "familiar", exposures: 4, accuracy: 0.65 },
  { strength: "learning", exposures: 1, accuracy: 0 },
];

/** Days until re-exposure at each strength, before the ease multiplier. */
const BASE_INTERVAL_DAYS: Record<MasteryStrength, number> = {
  new: 0,
  learning: 1,
  familiar: 3,
  strong: 7,
  mastered: 21,
};

const EASE_MIN = 1.3;
const EASE_MAX = 3.0;
const EASE_UP = 0.1;
const EASE_DOWN = 0.2;
/** The ease that produces an unmodified interval. Matches the column default. */
const EASE_NEUTRAL = 2.5;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function strengthRank(s: MasteryStrength): number {
  const i = STRENGTH_LADDER.indexOf(s);
  return i === -1 ? 0 : i;
}

/** Highest strength the counts alone would justify. */
function earnedStrength(exposures: number, correct: number): MasteryStrength {
  if (exposures <= 0) return "new";
  const accuracy = correct / exposures;
  for (const gate of GATES) {
    if (exposures >= gate.exposures && accuracy >= gate.accuracy) return gate.strength;
  }
  return "learning";
}

/**
 * Fold one answer into a mastery row.
 *
 * The rule that matters is the last one: a wrong answer can never promote. A
 * learner sitting just under a gate would otherwise cross it *by getting the
 * question wrong*, because one more exposure can lift the cumulative average
 * past the threshold. Capping at the previous strength on a miss keeps the
 * ladder monotone with respect to the thing it claims to measure.
 */
export function applyOutcome(
  prev: MasteryState,
  correct: boolean,
  now: Date = new Date(),
): MasteryUpdate {
  const exposures = prev.exposures + 1;
  const correctCount = prev.correct + (correct ? 1 : 0);
  const incorrect = prev.incorrect + (correct ? 0 : 1);
  const ease = clamp(prev.ease + (correct ? EASE_UP : -EASE_DOWN), EASE_MIN, EASE_MAX);

  const earned = earnedStrength(exposures, correctCount);
  const strength: MasteryStrength = correct
    ? earned
    : // Demote by one rung on a miss, but never below "learning" — the learner
      // has demonstrably seen this concept, so "new" would be a lie.
      STRENGTH_LADDER[clamp(strengthRank(prev.strength) - 1, 1, STRENGTH_LADDER.length - 1)];

  // A miss makes the concept due immediately, which is what puts it in the
  // coverage planner's `reinforce` list and into generated content next time.
  const days = correct ? (BASE_INTERVAL_DAYS[strength] * ease) / EASE_NEUTRAL : 0;
  const nextDue = new Date(now.getTime() + days * 86_400_000);

  return {
    exposures,
    correct: correctCount,
    incorrect,
    ease: Math.round(ease * 100) / 100,
    strength,
    last_seen_at: now.toISOString(),
    next_due_at: nextDue.toISOString(),
  };
}

/** Fold a whole drill — several questions against the same concept — in order. */
export function applyOutcomes(
  prev: MasteryState,
  outcomes: boolean[],
  now: Date = new Date(),
): MasteryUpdate | null {
  if (outcomes.length === 0) return null;
  let state: MasteryUpdate | null = null;
  let cursor: MasteryState = prev;
  for (const correct of outcomes) {
    state = applyOutcome(cursor, correct, now);
    cursor = state;
  }
  return state;
}

export function accuracy(state: Pick<MasteryState, "exposures" | "correct">): number | null {
  return state.exposures > 0 ? state.correct / state.exposures : null;
}

// ── Reading the model back out ───────────────────────────────────────────────

/** One concept's mastery, joined to enough of the concept to name it. */
export interface ConceptMastery extends MasteryState {
  conceptKey: string;
  /** Human-readable name; falls back to the key when the concept has no gloss. */
  label: string;
  nextDueAt: string | null;
  lastSeenAt: string | null;
}

/**
 * Concepts the learner is measurably shaky on, weakest first.
 *
 * Requires at least one miss: a concept with two correct answers and nothing
 * else sits at "learning" purely because it hasn't been seen enough, and
 * calling that a weakness would fill every prompt with things the learner has
 * never actually got wrong.
 */
export function pickWeakConcepts(
  concepts: ConceptMastery[],
  limit = 5,
  threshold = 0.75,
): ConceptMastery[] {
  return concepts
    .filter((c) => c.incorrect > 0 && (accuracy(c) ?? 1) < threshold)
    .sort((a, b) => {
      const byAccuracy = (accuracy(a) ?? 1) - (accuracy(b) ?? 1);
      // Tie-break on attempts so a 0/6 outranks a 0/1 — more evidence, more
      // confidence that it's a real gap rather than one bad guess.
      return byAccuracy !== 0 ? byAccuracy : b.exposures - a.exposures;
    })
    .slice(0, limit);
}

/**
 * Render weak grammar into the learner-profile prompt block.
 *
 * Returns "" when there's nothing to say, so callers can concatenate
 * unconditionally.
 */
export function renderWeakGrammarForPrompt(concepts: ConceptMastery[]): string {
  if (concepts.length === 0) return "";
  const named = concepts.map((c) => {
    const pct = Math.round((accuracy(c) ?? 0) * 100);
    return `${c.label} (${pct}% correct over ${c.exposures} attempts)`;
  });
  return (
    `- STRUGGLING with these grammar points: ${named.join("; ")}. ` +
    `Work at least one of them into the material naturally, in a context that models the correct form. ` +
    `Do not turn the content into a grammar lesson and do not mention this list.`
  );
}
