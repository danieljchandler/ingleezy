import { useAchievements, useUserAchievements } from "@/hooks/useGamification";
import { AchievementBadge } from "./AchievementBadge";
import { Trophy } from "lucide-react";

export function AchievementsGrid() {
  const { data: achievements, isLoading: loadingAchievements } = useAchievements();
  const { data: userAchievements, isLoading: loadingUser } = useUserAchievements();

  if (loadingAchievements || loadingUser) return null;
  if (!achievements) return null;

  const earnedIds = new Set(userAchievements?.map(ua => ua.achievement_id) || []);
  const earnedMap = new Map(userAchievements?.map(ua => [ua.achievement_id, ua.earned_at]) || []);

  const earnedCount = earnedIds.size;
  const totalCount = achievements.length;

  return (
    <div className="bg-card rounded-xl p-4 border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          <h3 className="font-semibold text-foreground">Achievements</h3>
        </div>
        <span className="text-sm text-muted-foreground">
          {earnedCount}/{totalCount}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {achievements.slice(0, 8).map((achievement) => (
          <AchievementBadge
            key={achievement.id}
            achievement={achievement}
            earned={earnedIds.has(achievement.id)}
            earnedAt={earnedMap.get(achievement.id)}
            size="sm"
            showDetails={false}
          />
        ))}
      </div>

      {achievements.length > 8 && (
        <p className="text-xs text-center text-muted-foreground mt-3">
          +{achievements.length - 8} more achievements
        </p>
      )}
    </div>
  );
}
