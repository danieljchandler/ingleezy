import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parseLocalDate } from "@/lib/localDate";
import { arCount } from "@/lib/strings";

export interface SmartNotification {
  id: string;
  type: "review_due" | "streak_risk" | "coach_advice" | "battle_invite" | "achievement" | "level_up" | "weekly_summary";
  title: string;
  body: string;
  icon: string;
  actionUrl?: string;
  priority: "high" | "medium" | "low";
  createdAt: Date;
}

export function useSmartNotifications() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["smart-notifications", user?.id],
    queryFn: async (): Promise<SmartNotification[]> => {
      if (!user) return [];

      const notifications: SmartNotification[] = [];
      const now = new Date();

      // 1. Check due reviews (word_reviews + user_vocabulary)
      const [{ count: dueWordReviews }, { count: dueUserVocab }] = await Promise.all([
        supabase
          .from("word_reviews")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .lte("next_review_at", now.toISOString()),
        supabase
          .from("user_vocabulary")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .lte("next_review_at", now.toISOString()),
      ]);

      const totalDue = (dueWordReviews || 0) + (dueUserVocab || 0);
      if (totalDue > 0) {
        notifications.push({
          id: "review-due",
          type: "review_due",
          title: arCount(totalDue, {
            one: "كلمة وحدة مستحقة للمراجعة",
            two: "كلمتان مستحقتان للمراجعة",
            few: "كلمات مستحقة للمراجعة",
            many: "كلمة مستحقة للمراجعة",
          }),
          body: totalDue >= 10 ? "لا تخلّها تفوتك! راجع الآن عشان تثبت." : "جلسة مراجعة سريعة تخلّي تقدّمك على السكة.",
          icon: "🧠",
          actionUrl: "/review",
          priority: totalDue >= 20 ? "high" : "medium",
          createdAt: now,
        });
      }

      // 2. Check streak risk
      const { data: streak } = await supabase
        .from("review_streaks")
        .select("current_streak, last_review_date")
        .eq("user_id", user.id)
        .maybeSingle();

      if (streak && streak.current_streak > 0 && streak.last_review_date) {
        // Parse the date-only column as LOCAL midnight so the "streak at risk"
        // window is measured in the user's timezone, not shifted by the UTC offset.
        const lastReview = parseLocalDate(streak.last_review_date);
        const hoursSince = (now.getTime() - lastReview.getTime()) / (1000 * 60 * 60);

        if (hoursSince >= 20 && hoursSince < 48) {
          notifications.push({
            id: "streak-risk",
            type: "streak_risk",
            title: `سلسلة ${streak.current_streak} يوم في خطر!`,
            body: "راجع قبل منتصف الليل عشان تبقى سلسلتك 🔥",
            icon: "🔥",
            actionUrl: "/review",
            priority: "high",
            createdAt: now,
          });
        }
      }

      // 3. Check for pending battles
      const { data: pendingBattles } = await supabase
        .from("vocab_battles")
        .select("id, challenger_id")
        .eq("opponent_id", user.id)
        .eq("status", "pending")
        .is("opponent_score", null);

      if (pendingBattles && pendingBattles.length > 0) {
        notifications.push({
          id: "battle-invite",
          type: "battle_invite",
          title: arCount(pendingBattles.length, {
            one: "تحدي كلمات ينتظرك",
            two: "تحديا كلمات ينتظرانك",
            few: "تحديات كلمات تنتظرك",
            many: "تحدي كلمات ينتظرك",
          }),
          body: "أحدهم تحدّاك! ورّهم وش عندك.",
          icon: "⚔️",
          actionUrl: "/battles",
          priority: "medium",
          createdAt: now,
        });
      }

      // 4. Check weekly coach recommendation
      const { data: latestRec } = await supabase
        .from("weekly_recommendations")
        .select("viewed_at, motivation_message, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRec && !latestRec.viewed_at) {
        notifications.push({
          id: "coach-advice",
          type: "coach_advice",
          title: "نصائح الأسبوع جاهزة",
          body: latestRec.motivation_message || "مدرّبك الذكي عنده نصائح مخصّصة لك.",
          icon: "🎯",
          actionUrl: "/analytics",
          priority: "low",
          createdAt: new Date(latestRec.created_at),
        });
      }

      // 5. Weekly summary (if it's Monday and no review today)
      if (now.getDay() === 1) {
        const { data: xpData } = await supabase
          .from("user_xp")
          .select("xp_this_week")
          .eq("user_id", user.id)
          .maybeSingle();

        if (xpData) {
          notifications.push({
            id: "weekly-summary",
            type: "weekly_summary",
            title: "أسبوع جديد، أهداف جديدة!",
            body: xpData.xp_this_week > 0
              ? `جمعت ${xpData.xp_this_week} نقطة الأسبوع الماضي. خلّنا نكسرها!`
              : "ابدأ الأسبوع بقوة — حدّد هدفاً!",
            icon: "📊",
            actionUrl: "/analytics",
            priority: "low",
            createdAt: now,
          });
        }
      }

      // Sort by priority
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return notifications.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 min
    refetchInterval: 10 * 60 * 1000, // refresh every 10 min
  });
}
