import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { currentWeekStartKey, localDateKey } from "@/lib/localDate";

export interface UserXP {
  id: string;
  user_id: string;
  total_xp: number;
  level: number;
  xp_this_week: number;
  week_start_date: string;
  xp_today: number;
  xp_today_date: string;
}

export interface Achievement {
  id: string;
  name: string;
  name_arabic: string;
  description: string;
  icon: string;
  xp_reward: number;
  requirement_type: string;
  requirement_value: number | null;
}

export interface UserAchievement {
  id: string;
  achievement_id: string;
  earned_at: string;
  achievement?: Achievement;
}

export interface WeeklyGoal {
  id: string;
  user_id: string;
  week_start_date: string;
  target_reviews: number;
  completed_reviews: number;
  target_xp: number;
  earned_xp: number;
}

// Calculate level from XP (every 500 XP = 1 level)
export function calculateLevel(xp: number): number {
  return Math.floor(xp / 500) + 1;
}

// XP needed for next level
export function xpForNextLevel(currentLevel: number): number {
  return currentLevel * 500;
}

// XP progress within current level
export function xpProgressInLevel(totalXp: number): { current: number; needed: number; percent: number } {
  const level = calculateLevel(totalXp);
  const xpAtLevelStart = (level - 1) * 500;
  const current = totalXp - xpAtLevelStart;
  const needed = 500;
  return { current, needed, percent: Math.round((current / needed) * 100) };
}

export function useUserXP() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-xp", user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from("user_xp")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      // Row is created server-side on first award_xp() call. Return a
      // default-shaped object so the UI renders zero state until then.
      if (!data) {
        return {
          id: "",
          user_id: user.id,
          total_xp: 0,
          level: 1,
          xp_this_week: 0,
          week_start_date: localDateKey(),
          xp_today: 0,
          xp_today_date: localDateKey(),
        } as UserXP;
      }

      // Cast via unknown: generated types.ts predates the xp_today/xp_today_date
      // columns (migration 20260723040000), so the select("*") row type is stale.
      return data as unknown as UserXP;
    },
    enabled: !!user,
  });
}

export function useAchievements() {
  return useQuery({
    queryKey: ["achievements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("achievements")
        .select("*")
        .order("display_order");

      if (error) throw error;
      return data as Achievement[];
    },
  });
}

export function useUserAchievements() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-achievements", user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from("user_achievements")
        .select(`
          *,
          achievement:achievements(*)
        `)
        .eq("user_id", user.id)
        .order("earned_at", { ascending: false });

      if (error) throw error;
      return data as (UserAchievement & { achievement: Achievement })[];
    },
    enabled: !!user,
  });
}

export function useWeeklyGoal() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["weekly-goal", user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Get current week's Monday — the shared boundary all writers use.
      const weekStart = currentWeekStartKey();

      const { data, error } = await supabase
        .from("weekly_goals")
        .select("*")
        .eq("user_id", user.id)
        .eq("week_start_date", weekStart)
        .maybeSingle();

      if (error) throw error;

      // Row is created server-side on first award_xp/increment_review_count
      // call. Return a default-shaped object so the UI renders zero state.
      if (!data) {
        return {
          id: "",
          user_id: user.id,
          week_start_date: weekStart,
          target_reviews: 0,
          completed_reviews: 0,
          target_xp: 0,
          earned_xp: 0,
        } as WeeklyGoal;
      }

      return data as WeeklyGoal;
    },
    enabled: !!user,
  });
}

/** The learner's current daily streak, written server-side by award_xp. */
export function useCurrentStreak() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["current-streak", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { data, error } = await supabase
        .from("review_streaks")
        .select("current_streak")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.current_streak ?? 0;
    },
    enabled: !!user,
  });
}

export function useAddXP() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ amount, reason }: { amount: number; reason: string }) => {
      if (!user) throw new Error("Not authenticated");

      // Determine previous level to detect level-up after server award.
      const { data: currentXP } = await supabase
        .from("user_xp")
        .select("total_xp")
        .eq("user_id", user.id)
        .maybeSingle();
      const oldLevel = currentXP ? calculateLevel(currentXP.total_xp) : 1;

      // Server-side clamped award (max 500/call).
      const { data, error } = await supabase.rpc("award_xp", {
        _amount: amount,
        _reason: reason,
      });
      if (error) throw error;

      const payload = (data ?? {}) as { total_xp?: number; level?: number; awarded?: number };
      const newTotalXP = payload.total_xp ?? 0;
      const newLevel = payload.level ?? calculateLevel(newTotalXP);
      const awarded = payload.awarded ?? 0;
      return { newTotalXP, levelUp: newLevel > oldLevel, newLevel, awarded };
    },
    onSuccess: (result, { reason }) => {
      queryClient.invalidateQueries({ queryKey: ["user-xp"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-goal"] });

      if (result.awarded > 0) {
        toast({
          title: `+${result.awarded} XP`,
          description: reason === "review" ? "Review completed!" : "Keep it up!",
          duration: 2000,
        });
      }

      if (result.levelUp) {
        setTimeout(() => {
          toast({
            title: `🎉 Level Up!`,
            description: `You've reached Level ${result.newLevel}!`,
          });
        }, 500);
      }
    },
  });
}

export function useIncrementReviews() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.rpc("increment_review_count");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weekly-goal"] });
    },
  });
}

// Check and award achievements. Server re-validates eligibility inside
// grant_achievement(); client filtering is best-effort.
export function useCheckAchievements() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      if (!user) return [];

      const [{ data: achievements }, { data: userAchievements }, { data: streak }] = await Promise.all([
        supabase.from("achievements").select("*"),
        supabase.from("user_achievements").select("achievement_id").eq("user_id", user.id),
        supabase.from("review_streaks").select("*").eq("user_id", user.id).maybeSingle(),
      ]);

      if (!achievements) return [];

      const earnedIds = new Set(userAchievements?.map((ua) => ua.achievement_id) || []);
      const newlyEarned: Achievement[] = [];

      const { count: totalReviews } = await supabase
        .from("word_reviews")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      const { count: wordsLearned } = await supabase
        .from("word_reviews")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("repetitions", 1);

      const currentStreak = streak?.current_streak || 0;

      for (const achievement of achievements) {
        if (earnedIds.has(achievement.id)) continue;

        let likelyEligible = false;
        const value = achievement.requirement_value || 0;

        switch (achievement.requirement_type) {
          case "reviews_completed":
            likelyEligible = (totalReviews || 0) >= value;
            break;
          case "words_learned":
            likelyEligible = (wordsLearned || 0) >= value;
            break;
          case "streak_days":
            likelyEligible = currentStreak >= value;
            break;
        }

        if (!likelyEligible) continue;

        const { data, error } = await supabase.rpc("grant_achievement", {
          _achievement_id: achievement.id,
        });
        if (error) continue;
        const result = (data ?? {}) as { granted?: boolean; already_earned?: boolean };
        if (result.granted) {
          newlyEarned.push(achievement as Achievement);
        }
      }

      return newlyEarned;
    },
    onSuccess: (newlyEarned) => {
      if (newlyEarned.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["user-achievements"] });
        queryClient.invalidateQueries({ queryKey: ["user-xp"] });

        newlyEarned.forEach((achievement) => {
          toast({
            title: `${achievement.icon} Achievement Unlocked!`,
            description: `${achievement.name} — +${achievement.xp_reward} XP`,
          });
        });
      }
    },
  });
}
