import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ConceptMastery, MasteryStrength } from "../../supabase/functions/_shared/conceptMasteryCore";

/**
 * The learner's grammar mastery, read from `user_concept_mastery`.
 *
 * Reads go straight to the table — RLS allows a learner to select their own
 * rows, and `curriculum_concepts` is readable by any authenticated user.
 * Writes do NOT: they go through the record-grammar-outcome edge function under
 * the service role, so a client can't post itself a mastery score. That
 * asymmetry is the point, and it's why there's no upsert here.
 */

const KEY = "grammar-mastery";

interface MasteryRow {
  exposures: number | null;
  correct: number | null;
  incorrect: number | null;
  ease: number | null;
  strength: MasteryStrength | null;
  next_due_at: string | null;
  last_seen_at: string | null;
  curriculum_concepts: {
    key: string;
    display_english: string | null;
  } | null;
}

/** Mastery for the active dialect, keyed by concept key (= drill category id). */
export const useGrammarMastery = (dialect: string) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: [KEY, user?.id, dialect],
    queryFn: async (): Promise<Map<string, ConceptMastery>> => {
      if (!user) return new Map();

      const { data, error } = await supabase
        .from("user_concept_mastery" as never)
        .select(
          "exposures, correct, incorrect, ease, strength, next_due_at, last_seen_at, " +
            "curriculum_concepts!inner(key, display_english, kind, dialect)",
        )
        .eq("user_id", user.id)
        .eq("curriculum_concepts.kind", "grammar")
        .eq("curriculum_concepts.dialect", dialect);

      if (error) throw error;

      const out = new Map<string, ConceptMastery>();
      for (const raw of (data ?? []) as unknown as MasteryRow[]) {
        const concept = raw.curriculum_concepts;
        if (!concept?.key) continue;
        out.set(concept.key, {
          conceptKey: concept.key,
          label: concept.display_english ?? concept.key,
          exposures: raw.exposures ?? 0,
          correct: raw.correct ?? 0,
          incorrect: raw.incorrect ?? 0,
          ease: raw.ease ?? 2.5,
          strength: raw.strength ?? "new",
          nextDueAt: raw.next_due_at,
          lastSeenAt: raw.last_seen_at,
        });
      }
      return out;
    },
    enabled: !!user,
  });
};

export interface GrammarOutcomeInput {
  category: string;
  categoryLabel?: string;
  dialect: string;
  /** One entry per question, in the order they were answered. */
  outcomes: boolean[];
}

/**
 * Post a finished drill's per-question results.
 *
 * Best-effort: the learner has already seen their score, so a failed write logs
 * and moves on rather than putting an error in front of them. The refetch on
 * success is what makes the category grid update behind the results screen.
 */
export const useRecordGrammarOutcome = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: GrammarOutcomeInput) => {
      if (input.outcomes.length === 0) return null;
      const { data, error } = await supabase.functions.invoke("record-grammar-outcome", {
        body: input,
      });
      if (error) throw error;
      return data as { recorded: number; conceptId?: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [KEY] });
    },
    onError: (err) => {
      console.warn("Couldn't record grammar mastery:", err);
    },
  });
};
