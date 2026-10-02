import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { effectiveStreak, lastSevenDays, STREAK_COLUMNS, type StreakDay } from "@/lib/streak";

/**
 * The learner's streak, as Today and the clips feed show it.
 *
 * Same query key and the same columns as `StreakDisplay`, so both share one
 * cached row and one invalidation (`useAddXP`'s
 * `["review-streak"]`). The number is derived rather than read — see
 * `effectiveStreak` for why the stored count goes stale.
 */
export function useReviewStreak(): { days: number; week: StreakDay[]; isLoading: boolean } {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["review-streak", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data: row } = await supabase
        .from("review_streaks")
        .select(STREAK_COLUMNS)
        .eq("user_id", user.id)
        .maybeSingle();
      return row;
    },
    enabled: !!user,
  });

  return { days: effectiveStreak(data), week: lastSevenDays(data), isLoading };
}
