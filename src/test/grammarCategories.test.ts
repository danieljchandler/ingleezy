import { describe, it, expect } from "vitest";
import {
  buildCategoryProgress,
  GRAMMAR_CATEGORIES,
  type GrammarCategory,
} from "@/lib/grammarCategories";
import type { ConceptMastery } from "../../supabase/functions/_shared/conceptMasteryCore";

const mastery = (over: Partial<ConceptMastery> & { conceptKey: string }): ConceptMastery => ({
  label: over.conceptKey,
  exposures: 10,
  correct: 5,
  incorrect: 5,
  ease: 2.5,
  strength: "learning",
  nextDueAt: null,
  lastSeenAt: null,
  ...over,
});

const map = (...rows: ConceptMastery[]) =>
  new Map(rows.map((r) => [r.conceptKey, r]));

/** A three-category stand-in so the fixtures don't have to fill all six. */
const CATS: GrammarCategory[] = [
  { id: "negation", label: "Negation", labelAr: "النفي", icon: "🚫" },
  { id: "pronouns", label: "Pronouns", labelAr: "الضمائر", icon: "👤" },
  { id: "questions", label: "Question Forms", labelAr: "الأسئلة", icon: "❓" },
];

describe("buildCategoryProgress", () => {
  it("leaves untouched categories with nothing to display", () => {
    const rows = buildCategoryProgress(new Map(), CATS);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.mastery).toBeNull();
      // A zeroed-out bar on a category you've never opened is noise, not data.
      expect(r.strengthLabel).toBeNull();
      expect(r.accuracyPct).toBeNull();
    }
  });

  it("reports accuracy as a whole percentage", () => {
    const rows = buildCategoryProgress(
      map(mastery({ conceptKey: "negation", exposures: 8, correct: 3 })),
      CATS,
    );
    expect(rows.find((r) => r.id === "negation")!.accuracyPct).toBe(38);
  });

  it("prefers an untouched category over a weak one for the nudge", () => {
    // With five of six categories untried, ranking the two you have tried is
    // less useful than pointing at one you haven't.
    const rows = buildCategoryProgress(
      map(mastery({ conceptKey: "negation", exposures: 10, correct: 1 })),
      CATS,
    );
    expect(rows.find((r) => r.focus)!.id).toBe("pronouns");
  });

  it("falls back to the weakest once everything has been tried", () => {
    const rows = buildCategoryProgress(
      map(
        mastery({ conceptKey: "negation", exposures: 10, correct: 7 }),
        mastery({ conceptKey: "pronouns", exposures: 10, correct: 3 }),
        mastery({ conceptKey: "questions", exposures: 10, correct: 6 }),
      ),
      CATS,
    );
    expect(rows.find((r) => r.focus)!.id).toBe("pronouns");
  });

  it("nudges toward nothing when the learner is solid across the board", () => {
    const rows = buildCategoryProgress(
      map(
        mastery({ conceptKey: "negation", exposures: 10, correct: 10, strength: "mastered" }),
        mastery({ conceptKey: "pronouns", exposures: 10, correct: 9, strength: "strong" }),
        mastery({ conceptKey: "questions", exposures: 10, correct: 10, strength: "mastered" }),
      ),
      CATS,
    );
    expect(rows.some((r) => r.focus)).toBe(false);
  });

  it("marks exactly one category as the focus", () => {
    const rows = buildCategoryProgress(
      map(mastery({ conceptKey: "negation", exposures: 4, correct: 1 })),
      CATS,
    );
    expect(rows.filter((r) => r.focus)).toHaveLength(1);
  });

  it("covers every real category, in order", () => {
    const rows = buildCategoryProgress(new Map());
    expect(rows.map((r) => r.id)).toEqual(GRAMMAR_CATEGORIES.map((c) => c.id));
  });

  it("keeps the category ids the edge function will accept", () => {
    // These ids are curriculum_concepts.key values, not display strings —
    // renaming one starts a fresh concept and orphans the old mastery, and the
    // record-grammar-outcome allowlist would reject it.
    expect(GRAMMAR_CATEGORIES.map((c) => c.id)).toEqual([
      "articles",
      "verb-conjugation",
      "prepositions",
      "pronouns",
      "negation",
      "possessives",
      "questions",
      "sentence-structure",
    ]);
  });
});
