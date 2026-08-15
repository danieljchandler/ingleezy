import { useWeeklyGoal } from "@/hooks/useGamification";
import { Progress } from "@/components/ui/progress";
import { Target, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface WeeklyGoalCardProps {
  className?: string;
}

export function WeeklyGoalCard({ className }: WeeklyGoalCardProps) {
  const { data: goal, isLoading } = useWeeklyGoal();

  if (isLoading || !goal) return null;

  /**
   * A target of zero is a goal nobody set, not a goal already met.
   *
   * `completed / target` is 0/0 when a target is zero, so the percentage was
   * NaN and reached the progress bar unguarded, while the separate completion
   * check — `0 >= 0` — was true. The card ticked the goal, turned it green and
   * fired the confetti line for a week in which nothing was done, above a bar
   * the Progress wrapper's `value || 0` had quietly emptied. Targets are
   * written by the goal-setting path rather than being a constant, so a learner
   * whose targets are derived from a previous week of no activity gets one.
   */
  const percentOf = (done: number, target: number) =>
    target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;

  const reviewPercent = percentOf(goal.completed_reviews, goal.target_reviews);
  const xpPercent = percentOf(goal.earned_xp, goal.target_xp);

  const reviewComplete = goal.target_reviews > 0 && goal.completed_reviews >= goal.target_reviews;
  const xpComplete = goal.target_xp > 0 && goal.earned_xp >= goal.target_xp;

  return (
    <div className={cn("bg-card rounded-xl p-4 border border-border", className)}>
      <div className="flex items-center gap-2 mb-4">
        <Target className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-foreground">أهداف الأسبوع</h3>
      </div>

      <div className="space-y-4">
        {/* Reviews Goal */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-muted-foreground">Reviews</span>
            <span className={cn(
              "text-sm font-medium",
              reviewComplete ? "text-green-600 dark:text-green-400" : "text-foreground"
            )}>
              {goal.completed_reviews}/{goal.target_reviews}
              {reviewComplete && " ✓"}
            </span>
          </div>
          <Progress 
            value={reviewPercent} 
            className={cn("h-2", reviewComplete && "[&>div]:bg-green-500")}
          />
        </div>

        {/* XP Goal */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-sm text-muted-foreground">XP Earned</span>
            </div>
            <span className={cn(
              "text-sm font-medium",
              xpComplete ? "text-green-600 dark:text-green-400" : "text-foreground"
            )}>
              {goal.earned_xp}/{goal.target_xp}
              {xpComplete && " ✓"}
            </span>
          </div>
          <Progress 
            value={xpPercent} 
            className={cn("h-2", xpComplete && "[&>div]:bg-green-500")}
          />
        </div>
      </div>

      {reviewComplete && xpComplete && (
        <div className="mt-4 p-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-center">
          <span className="text-sm font-medium text-green-700 dark:text-green-400">
            🎉 Weekly goals complete!
          </span>
        </div>
      )}
    </div>
  );
}
