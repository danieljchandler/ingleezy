import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const DEFAULT_RETENTION = 0.9;

/**
 * The learner's FSRS retention target (profiles.desired_retention), defaulting
 * to the classic 90%. Every scheduler call site reads this so the dial in
 * Settings changes real intervals, not just a label. Signed-out learners and
 * fetch failures get the default — the scheduler must never wait on, or break
 * because of, a preference read.
 */
export function useDesiredRetention(): number {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["desired-retention", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<number> => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("desired_retention")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) return DEFAULT_RETENTION;
      const value = (profile as { desired_retention?: number | null } | null)?.desired_retention;
      return typeof value === "number" && value >= 0.7 && value <= 0.97 ? value : DEFAULT_RETENTION;
    },
  });
  return data ?? DEFAULT_RETENTION;
}
