import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

/**
 * Server-persisted "new cards studied today" counter, shared across both SRS
 * review paths (curriculum word_reviews and personal user_vocabulary) so a
 * learner's daily new-card cap is a real daily limit, not a per-page-load
 * one. See migration 20260723030000_daily_new_card_counts.sql.
 */
export function useNewCardsToday() {
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);

  return useQuery({
    queryKey: ["daily-new-card-count", user?.id, today],
    queryFn: async () => {
      if (!user) return 0;
      const { data } = await (supabase
        .from("daily_new_card_counts" as never)
        .select("count") as any)
        .eq("user_id", user.id)
        .eq("day", today)
        .maybeSingle();
      return (data as { count: number } | null)?.count ?? 0;
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

/** Given a configured daily cap, how many more new cards may be introduced today. */
export function useRemainingNewCardBudget(cap: number) {
  const { data: countToday = 0, isLoading } = useNewCardsToday();
  return { remaining: Math.max(0, cap - countToday), countToday, isLoading };
}

/** Call once per card the first time it is actually rated (never on fetch/display). */
export function useClaimNewCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("increment_new_card_count", { _amount: 1 });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-new-card-count"] });
    },
  });
}
