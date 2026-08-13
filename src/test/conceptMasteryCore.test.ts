import { describe, it, expect } from "vitest";
import {
  accuracy,
  applyOutcome,
  applyOutcomes,
  INITIAL_MASTERY,
  pickWeakConcepts,
  renderWeakGrammarForPrompt,
  strengthRank,
  type ConceptMastery,
  type MasteryState,
} from "../../supabase/functions/_shared/conceptMasteryCore";

const NOW = new Date("2026-07-31T12:00:00.000Z");

const state = (over: Partial<MasteryState> = {}): MasteryState => ({
  ...INITIAL_MASTERY,
  ...over,
});

/** Days between `now` and an ISO due date, to one decimal place. */
const dueInDays = (iso: string, now: Date = NOW) =>
  Math.round(((Date.parse(iso) - now.getTime()) / 86_400_000) * 10) / 10;

describe("applyOutcome", () => {
  it("counts a first correct answer without declaring mastery", () => {
    const next = applyOutcome(state(), true, NOW);
    expect(next.exposures).toBe(1);
    expect(next.correct).toBe(1);
    expect(next.incorrect).toBe(0);
    // One right answer is one right answer, whatever the accuracy says.
    expect(next.strength).toBe("learning");
  });

  it("counts a first wrong answer as learning rather than new", () => {
    const next = applyOutcome(state(), false, NOW);
    expect(next.incorrect).toBe(1);
    // The learner has demonstrably met the concept; "new" would be a lie.
    expect(next.strength).toBe("learning");
  });

  it("never promotes on a wrong answer, even when the average crosses a gate", () => {
    // 7/7 sits one exposure below the "strong" gate (8 attempts, 80%).
    // An eighth attempt gives 8 exposures at 87.5% — over the gate — so a
    // naive recompute would promote familiar → strong for getting it wrong.
    const prev = state({ exposures: 7, correct: 7, incorrect: 0, strength: "familiar" });
    const promoted = applyOutcome(prev, true, NOW);
    expect(promoted.strength).toBe("strong");

    const missed = applyOutcome(prev, false, NOW);
    expect(missed.exposures).toBe(8);
    expect(accuracy(missed)).toBeGreaterThan(0.8);
    expect(strengthRank(missed.strength)).toBeLessThan(strengthRank(prev.strength));
    expect(missed.strength).toBe("learning");
  });

  it("demotes by one rung and floors at learning", () => {
    expect(applyOutcome(state({ strength: "mastered", exposures: 20, correct: 20 }), false, NOW).strength)
      .toBe("strong");
    expect(applyOutcome(state({ strength: "learning", exposures: 2, correct: 1, incorrect: 1 }), false, NOW).strength)
      .toBe("learning");
  });

  it("makes a missed concept due immediately so it gets reinforced next", () => {
    const next = applyOutcome(state({ exposures: 10, correct: 9, strength: "strong" }), false, NOW);
    expect(dueInDays(next.next_due_at)).toBe(0);
  });

  it("spaces a correct answer further out the stronger the concept is", () => {
    const familiar = applyOutcome(
      state({ exposures: 5, correct: 5, strength: "familiar", ease: 2.5 }),
      true,
      NOW,
    );
    const strong = applyOutcome(
      state({ exposures: 10, correct: 10, strength: "strong", ease: 2.5 }),
      true,
      NOW,
    );
    expect(dueInDays(familiar.next_due_at)).toBeGreaterThan(0);
    expect(dueInDays(strong.next_due_at)).toBeGreaterThan(dueInDays(familiar.next_due_at));
  });

  it("clamps ease to the SM-2 range in both directions", () => {
    let s: MasteryState = state({ ease: 2.9 });
    for (let i = 0; i < 10; i++) s = applyOutcome(s, true, NOW);
    expect(s.ease).toBeLessThanOrEqual(3.0);

    let t: MasteryState = state({ ease: 1.5 });
    for (let i = 0; i < 10; i++) t = applyOutcome(t, false, NOW);
    expect(t.ease).toBeGreaterThanOrEqual(1.3);
  });
});

describe("applyOutcomes", () => {
  it("folds a whole drill in order", () => {
    const next = applyOutcomes(state(), [true, false, true, true, false], NOW);
    expect(next).not.toBeNull();
    expect(next!.exposures).toBe(5);
    expect(next!.correct).toBe(3);
    expect(next!.incorrect).toBe(2);
  });

  it("is order-sensitive on strength — ending on a miss demotes", () => {
    const endsCorrect = applyOutcomes(state(), [false, false, true], NOW)!;
    const endsWrong = applyOutcomes(state(), [true, false, false], NOW)!;
    expect(endsCorrect.correct).toBe(endsWrong.correct);
    expect(endsCorrect.exposures).toBe(endsWrong.exposures);
    // Same counts, different last answer: the miss must not be averaged away.
    expect(dueInDays(endsWrong.next_due_at)).toBe(0);
    expect(dueInDays(endsCorrect.next_due_at)).toBeGreaterThan(0);
  });

  it("returns null for an empty drill rather than writing a no-op row", () => {
    expect(applyOutcomes(state(), [], NOW)).toBeNull();
  });
});

describe("pickWeakConcepts", () => {
  const concept = (over: Partial<ConceptMastery>): ConceptMastery => ({
    conceptKey: "negation",
    label: "Negation",
    exposures: 10,
    correct: 5,
    incorrect: 5,
    ease: 2.5,
    strength: "learning",
    nextDueAt: null,
    lastSeenAt: null,
    ...over,
  });

  it("ignores concepts the learner has never got wrong", () => {
    const weak = pickWeakConcepts([
      concept({ conceptKey: "pronouns", exposures: 2, correct: 2, incorrect: 0 }),
    ]);
    // 2/2 is only "learning" because it's barely been seen. Calling that a
    // weakness would fill every prompt with things never actually missed.
    expect(weak).toEqual([]);
  });

  it("ignores concepts above the accuracy threshold", () => {
    const weak = pickWeakConcepts([
      concept({ conceptKey: "questions", exposures: 10, correct: 9, incorrect: 1 }),
    ]);
    expect(weak).toEqual([]);
  });

  it("orders weakest first, breaking ties on evidence", () => {
    const weak = pickWeakConcepts([
      concept({ conceptKey: "possessives", exposures: 10, correct: 6, incorrect: 4 }),
      concept({ conceptKey: "one-bad-guess", exposures: 1, correct: 0, incorrect: 1 }),
      concept({ conceptKey: "really-stuck", exposures: 6, correct: 0, incorrect: 6 }),
    ]);
    expect(weak.map((c) => c.conceptKey)).toEqual([
      "really-stuck",
      "one-bad-guess",
      "possessives",
    ]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      concept({ conceptKey: `c${i}`, exposures: 4, correct: 0, incorrect: 4 }));
    expect(pickWeakConcepts(many, 3)).toHaveLength(3);
  });
});

describe("renderWeakGrammarForPrompt", () => {
  it("returns an empty string when there is nothing to say", () => {
    expect(renderWeakGrammarForPrompt([])).toBe("");
  });

  it("names each point with its accuracy", () => {
    const out = renderWeakGrammarForPrompt([{
      conceptKey: "negation",
      label: "Negation",
      exposures: 8,
      correct: 2,
      incorrect: 6,
      ease: 2.1,
      strength: "learning",
      nextDueAt: null,
      lastSeenAt: null,
    }]);
    expect(out).toContain("Negation (25% correct over 8 attempts)");
    expect(out).toContain("do not mention this list");
  });
});
