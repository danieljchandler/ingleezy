import { Achievement } from "@/hooks/useGamification";
import { cn } from "@/lib/utils";

interface AchievementBadgeProps {
  achievement: Achievement;
  earned?: boolean;
  earnedAt?: string;
  size?: "sm" | "md" | "lg";
  showDetails?: boolean;
}

export function AchievementBadge({ 
  achievement, 
  earned = false, 
  earnedAt,
  size = "md",
  showDetails = true
}: AchievementBadgeProps) {
  const sizeClasses = {
    sm: "w-12 h-12 text-xl",
    md: "w-16 h-16 text-2xl",
    lg: "w-20 h-20 text-3xl",
  };

  return (
    <div className={cn(
      "flex flex-col items-center text-center",
      !earned && "opacity-40 grayscale"
    )}>
      <div className={cn(
        "rounded-full flex items-center justify-center",
        "bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/40 dark:to-amber-800/40",
        "border-2",
        earned 
          ? "border-amber-400 shadow-lg shadow-amber-200/50 dark:shadow-amber-900/30" 
          : "border-muted",
        sizeClasses[size]
      )}>
        <span>{achievement.icon}</span>
      </div>
      
      {showDetails && (
        <>
          <p className={cn(
            "font-semibold text-foreground mt-2",
            size === "sm" ? "text-xs" : "text-sm"
          )}>
            {achievement.name}
          </p>
          {size !== "sm" && (
            <p className="text-xs text-muted-foreground mt-0.5 max-w-[120px]">
              {achievement.description}
            </p>
          )}
          {/*
            Gated on `earned` alone. It used to require `earnedAt` too, and
            user_achievements.earned_at is nullable — so a row from a backfill
            or a manual grant showed gold and full colour while silently
            dropping the XP line, making an earned achievement look worth
            nothing.
          */}
          {earned && (
            <p className="text-xs text-primary mt-1">
              +{achievement.xp_reward} XP
            </p>
          )}
          {/*
            And the date itself now reaches the screen. It was typed and named
            as a timestamp and used only as a boolean, so "when did I earn
            this?" was unanswerable from the grid.
          */}
          {earned && earnedAt && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {new Date(earnedAt).toLocaleDateString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}
