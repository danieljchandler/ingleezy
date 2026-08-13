// Pure half of the learner model: types, bucketing, sampling, and prompt
// rendering. Free of Deno globals and esm.sh imports — the one import is the
// equally pure conceptMasteryCore — so it can be unit-tested from the frontend
// Vitest suite (src/test/learnerProfileCore.test.ts) while the IO half
// (learnerProfile.ts) stays a Deno edge-function module.
//
// See learnerProfile.ts for why this exists at all.

import {
  pickWeakConcepts,
  renderWeakGrammarForPrompt,
  type ConceptMastery,
} from "./conceptMasteryCore.ts";

export interface LearnerWord {
  arabic: string;
  english: string;
}

export interface LearnerProfile {
  userId: string;
  dialect: string;
  /** Human-readable dialect name, resolved by the caller. */
  dialectLabel: string;
  /** CEFR level for this dialect (e.g. "A2"), or null if never placed. */
  level: string | null;
  /** Free-text reason the learner gave at onboarding ("working in Dubai"). */
  reason: string | null;
  /** Topic interests, from the same categories offered in Listen. */
  interests: string[];
  /** Well-established words — safe to build on without glossing. */
  known: LearnerWord[];
  /** Currently being learned — worth reinforcing in context. */
  learning: LearnerWord[];
  /** Leeches, repeat lapses, and recent production errors — target these. */
  weak: LearnerWord[];
  /** Total established words, before sampling. Signals overall lexicon size. */
  knownTotal: number;
  /**
   * Grammar points the learner keeps missing in drills. Empty for anyone who
   * hasn't drilled, which is why every consumer treats it as optional.
   */
  weakGrammar: ConceptMastery[];
}

export interface ProfileBudget {
  known: number;
  learning: number;
  weak: number;
}

export const DEFAULT_BUDGET: ProfileBudget = { known: 120, learning: 20, weak: 15 };

/**
 * Stability (days) at which a word counts as genuinely known rather than
 * still-being-learned. Matches the "mature" threshold generate-daily-story has
 * used since it was written, so story behaviour is unchanged by the move to
 * this shared module.
 */
export const MATURE_INTERVAL_DAYS = 7;

/** A scheduling snapshot for one card, normalised across the two deck shapes. */
export interface ScheduleRow {
  arabic: string | null;
  english: string | null;
  intervalDays: number | null;
  repetitions: number | null;
  /** null = the deck doesn't track lapses (word_reviews), not "zero lapses". */
  lapses: number | null;
  /** null = the deck doesn't track leeches (word_reviews), not "not a leech". */
  isLeech: boolean | null;
}

export interface Buckets {
  known: LearnerWord[];
  learning: LearnerWord[];
  weak: LearnerWord[];
}

/** Deduplicate on the Arabic surface form, preserving order. */
export function dedupe(words: LearnerWord[]): LearnerWord[] {
  const seen = new Set<string>();
  const out: LearnerWord[] = [];
  for (const w of words) {
    if (seen.has(w.arabic)) continue;
    seen.add(w.arabic);
    out.push(w);
  }
  return out;
}

/**
 * Take `n` items, biased toward the front of the list but with a random tail.
 *
 * The front bias keeps the most relevant words (strongest / most recent) in
 * every prompt; the random tail means two calls on the same day don't produce
 * identical content from an identical word list.
 */
export function sample<T>(items: T[], n: number, rng: () => number = Math.random): T[] {
  if (n <= 0) return [];
  if (items.length <= n) return items;
  const headCount = Math.ceil(n / 2);
  const head = items.slice(0, headCount);
  const rest = items.slice(headCount);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...head, ...rest.slice(0, n - headCount)];
}

/**
 * Sort scheduling rows into known / learning / weak.
 *
 * `errorTargets` are Arabic surface forms the learner has recently produced
 * incorrectly; they land in `weak` regardless of what their schedule says,
 * because a comfortable interval on a word you can't say is exactly the case
 * the SRS alone can't see.
 */
export function classifyRows(rows: ScheduleRow[], errorTargets: Set<string> = new Set()): Buckets {
  const known: LearnerWord[] = [];
  const learning: LearnerWord[] = [];
  const weak: LearnerWord[] = [];
  const knownArabic = new Set<string>();

  for (const row of rows) {
    const arabic = row.arabic?.trim();
    const english = row.english?.trim();
    if (!arabic || !english) continue;
    const word: LearnerWord = { arabic, english };

    const interval = row.intervalDays ?? 0;
    const reps = row.repetitions ?? 0;
    const mature = interval >= MATURE_INTERVAL_DAYS && reps > 0;
    const struggling = row.isLeech === true || (row.lapses ?? 0) >= 2;

    // A leech is still seen material, so it counts toward the lexicon — it just
    // needs targeting rather than assuming.
    if (mature) {
      known.push(word);
      knownArabic.add(arabic);
    } else {
      learning.push(word);
    }

    if (struggling || errorTargets.has(arabic)) weak.push(word);
  }

  return {
    known: dedupe(known),
    // The same word can appear in both decks at different maturities. Without
    // this filter it would land in known AND learning, and the prompt would
    // tell the model a word is simultaneously mastered and in need of
    // reinforcement. Filtering after the loop also covers the case where the
    // immature row is processed first.
    learning: dedupe(learning).filter((w) => !knownArabic.has(w.arabic)),
    weak: dedupe(weak),
  };
}

/**
 * Render a profile into the prompt block passed to askBrain as
 * `systemPromptExtra` (appended to the dialect system prompt by buildSystem).
 *
 * Kept here rather than at each call site so every generator describes the
 * learner identically — otherwise the same profile produces different behaviour
 * in reading vs listening vs drills.
 *
 * Returns "" for a learner we know nothing about, so callers can concatenate
 * unconditionally and a cold-start user simply gets the generic prompt.
 */
export function renderProfileForPrompt(
  profile: LearnerProfile,
  opts: { includeWeak?: boolean; includeInterests?: boolean; target?: "arabic" | "english" } = {},
): string {
  const { includeWeak = true, includeInterests = true, target = "arabic" } = opts;
  const lines: string[] = [];

  // The decks store every card bilingually, so one profile serves both
  // generation directions — only the presentation flips. English-target
  // renders the English side first (that is the word being learned; the
  // Arabic is its scaffold) and names the lexicon "English" rather than the
  // dialect, since there the dialect is the learner's L1, not the subject.
  const list = (words: LearnerWord[]) =>
    words
      .map((w) => (target === "english" ? `${w.english} (${w.arabic})` : `${w.arabic} (${w.english})`))
      .join(", ");

  if (profile.level) {
    lines.push(`- CEFR level: ${profile.level}. Pitch the language at this level.`);
  }
  if (profile.knownTotal > 0) {
    const lexicon = target === "english" ? "English" : profile.dialectLabel;
    lines.push(`- Active ${lexicon} vocabulary: roughly ${profile.knownTotal} words.`);
  }
  if (includeInterests && profile.reason) {
    lines.push(`- Why they are learning: ${profile.reason}. Prefer situations relevant to this.`);
  }
  if (includeInterests && profile.interests.length > 0) {
    lines.push(`- Interested in: ${profile.interests.join(", ")}.`);
  }
  if (profile.known.length > 0) {
    lines.push(`- KNOWN words (use freely, no need to simplify around them): ${list(profile.known)}`);
  }
  if (profile.learning.length > 0) {
    lines.push(
      `- LEARNING words (reuse where natural so they get another exposure in context): ${list(profile.learning)}`,
    );
  }
  if (includeWeak && profile.weak.length > 0) {
    lines.push(
      `- STRUGGLING with these (work at least one or two in, in a clear context that makes the meaning inferable): ${list(profile.weak)}`,
    );
  }
  if (includeWeak) {
    // Lexical weakness and structural weakness are different problems and want
    // different treatment: a shaky word wants another exposure in context, a
    // shaky grammar point wants the correct form modelled. Kept as its own line
    // so the model doesn't blur them.
    const grammar = renderWeakGrammarForPrompt(pickWeakConcepts(profile.weakGrammar ?? []));
    if (grammar) lines.push(grammar);
  }

  if (lines.length === 0) return "";

  return `LEARNER PROFILE — tailor the content to this specific learner.
${lines.join("\n")}
Build mostly from KNOWN words so the material is comprehensible, and stretch slightly beyond it — aim for roughly one unfamiliar word in twenty, not a vocabulary test. Never list these words or mention this profile in the output.`;
}
