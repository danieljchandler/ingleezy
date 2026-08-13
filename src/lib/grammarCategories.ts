import {
  accuracy,
  strengthRank,
  type ConceptMastery,
  type MasteryStrength,
} from "../../supabase/functions/_shared/conceptMasteryCore";
import type { GrammarCategoryId } from "../../supabase/functions/_shared/grammarTaxonomy";

/**
 * The grammar-drill taxonomy, and the presentation logic for a learner's
 * mastery of it.
 *
 * The category ids are also `curriculum_concepts.key` values — they're what
 * record-grammar-outcome writes mastery against, so they are a contract, not
 * display strings. Renaming one starts a fresh concept and orphans the old
 * mastery; the edge function keeps its own copy of the id list as an allowlist
 * so a drift shows up as a 400 rather than as silently split history.
 *
 * The ladder itself (promotion gates, scheduling) lives in the shared
 * conceptMasteryCore module so the server and the UI agree on what a strength
 * means; this file only decides how to say it.
 */

export interface GrammarCategory {
  id: GrammarCategoryId;
  label: string;
  labelAr: string;
  icon: string;
}

/**
 * Ids come from the shared taxonomy, so this file only supplies presentation.
 * Typing `id` as GrammarCategoryId means a typo here is a compile error rather
 * than a category that silently records mastery nothing else can find.
 */
export const GRAMMAR_CATEGORIES: GrammarCategory[] = [
  { id: "verb-conjugation", label: "Verb Conjugation", labelAr: "تصريف الأفعال", icon: "🔄" },
  { id: "pronouns", label: "Pronouns", labelAr: "الضمائر", icon: "👤" },
  { id: "negation", label: "Negation", labelAr: "النفي", icon: "🚫" },
  { id: "possessives", label: "Possessives", labelAr: "الملكية", icon: "🏠" },
  { id: "questions", label: "Question Forms", labelAr: "الأسئلة", icon: "❓" },
  { id: "sentence-structure", label: "Sentence Structure", labelAr: "بنية الجملة", icon: "📝" },
];

/** Wording shown on a category tile. "new" never appears — an untouched tile shows nothing. */
const STRENGTH_LABEL: Record<MasteryStrength, string> = {
  new: "Not started",
  learning: "Just started",
  familiar: "Getting there",
  strong: "Strong",
  mastered: "Mastered",
};

const STRENGTH_CLASS: Record<MasteryStrength, string> = {
  new: "bg-muted text-muted-foreground",
  learning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  familiar: "bg-primary/15 text-primary",
  strong: "bg-primary/25 text-primary",
  mastered: "bg-green-500/15 text-green-700 dark:text-green-400",
};

export interface CategoryProgress extends GrammarCategory {
  /** null when the learner has never drilled this category. */
  mastery: ConceptMastery | null;
  strengthLabel: string | null;
  strengthClass: string;
  /** 0–100, or null when untouched. */
  accuracyPct: number | null;
  /** True for the single category most worth drilling next. */
  focus: boolean;
}

/**
 * Join the fixed category list to whatever mastery the learner has, and pick
 * the one to nudge them toward.
 *
 * The nudge deliberately prefers an untouched category over a weak one: with
 * six categories and no history, "you haven't tried negation yet" is more
 * useful than ranking the two you have tried. Once everything has been seen it
 * falls back to the weakest, which is the case that actually needs the ladder.
 */
export function buildCategoryProgress(
  masteryByKey: Map<string, ConceptMastery>,
  categories: GrammarCategory[] = GRAMMAR_CATEGORIES,
): CategoryProgress[] {
  const rows = categories.map((cat) => {
    const mastery = masteryByKey.get(cat.id) ?? null;
    const acc = mastery ? accuracy(mastery) : null;
    return {
      ...cat,
      mastery,
      strengthLabel: mastery ? STRENGTH_LABEL[mastery.strength] : null,
      strengthClass: STRENGTH_CLASS[mastery?.strength ?? "new"],
      accuracyPct: acc === null ? null : Math.round(acc * 100),
      focus: false,
    };
  });

  const focusId = pickFocusCategory(rows);
  return rows.map((r) => (r.id === focusId ? { ...r, focus: true } : r));
}

function pickFocusCategory(rows: CategoryProgress[]): string | null {
  const untouched = rows.filter((r) => !r.mastery);
  if (untouched.length > 0) return untouched[0].id;

  // Everything has been tried: surface the weakest by accuracy, breaking ties
  // on the lower rung so a fresh 50% outranks a long-established 50%.
  const ranked = [...rows].sort((a, b) => {
    const byAccuracy = (a.accuracyPct ?? 100) - (b.accuracyPct ?? 100);
    if (byAccuracy !== 0) return byAccuracy;
    return strengthRank(a.mastery!.strength) - strengthRank(b.mastery!.strength);
  });
  const weakest = ranked[0];
  // Nothing to nudge toward when the learner is solid everywhere.
  return weakest && (weakest.accuracyPct ?? 100) < 85 ? weakest.id : null;
}
