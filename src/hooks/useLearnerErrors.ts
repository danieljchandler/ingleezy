import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { groupMistakes, type LearnerErrorRow, type MistakeGroup } from "@/lib/mistakes";

/**
 * The learner's own error corpus.
 *
 * Rows are written by the scoring edge functions under the service role. The
 * client can read its own and set `resolved_at` — and nothing else: the
 * 20260726140000 migration revoked blanket UPDATE and re-granted it on that one
 * column, so a learner can dismiss a mistake but not rewrite what it says. That
 * matters because `target_arabic` and `detail` feed their own content
 * generation.
 */

const KEY = "learner-errors";

/** How many recent unresolved rows to consider. Bounded to keep the page fast. */
const LIMIT = 300;

export const useMistakes = (dialect: string) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: [KEY, user?.id, dialect],
    queryFn: async (): Promise<MistakeGroup[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("learner_errors" as never)
        .select("id, dialect, source, target_arabic, produced_arabic, error_kind, created_at")
        .eq("user_id", user.id)
        .eq("dialect", dialect)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(LIMIT);

      if (error) throw error;
      return groupMistakes((data ?? []) as unknown as LearnerErrorRow[]);
    },
    enabled: !!user,
  });
};

/**
 * Mark every error recorded against one target as resolved.
 *
 * Takes the group's row ids rather than re-deriving the match server-side, so
 * dismissing clears exactly what the learner was looking at — not anything
 * recorded in between by a scoring call still in flight.
 */
export const useResolveMistake = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { error } = await supabase
        .from("learner_errors" as never)
        .update({ resolved_at: new Date().toISOString() } as never)
        .in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
};
