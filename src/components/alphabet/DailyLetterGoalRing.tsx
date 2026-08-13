import { useMemo } from "react";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlphabetProgress } from "@/hooks/useAlphabetProgress";

interface DailyLetterGoalRingProps {
  /** Target letters to master per day. Default 3. */
  goal?: number;
  className?: string;
}

/**
 * Compact ring widget that lives next to the streak display on Home.
 * Shows progress toward today's letter-mastery goal pulled from
 * `useAlphabetProgress` (counts letters whose `mastered_at` is today).
 */
export const DailyLetterGoalRing = ({ goal = 3, className }: DailyLetterGoalRingProps) => {
  const { progress } = useAlphabetProgress();

  const masteredToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    return Object.values(progress).filter((r) => {
      if (!r.mastered_at) return false;
      const t = new Date(r.mastered_at).getTime();
      return t >= startMs;
    }).length;
  }, [progress]);

  const pct = Math.min(1, masteredToday / Math.max(1, goal));
  const SIZE = 56;
  const STROKE = 5;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const dash = C * pct;

  const complete = masteredToday >= goal;

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 bg-card",
        complete ? "border-amber-500/60" : "border-border",
        className,
      )}
      title={`${masteredToday} of ${goal} letters mastered today`}
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={complete ? "hsl(38 92% 50%)" : "hsl(var(--primary))"}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${C - dash}`}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {complete ? (
            <Flame className="h-5 w-5 text-amber-500" />
          ) : (
            <span className="text-xs font-bold text-foreground tabular-nums">
              {masteredToday}/{goal}
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground leading-tight">
          {complete ? "Goal hit!" : "Daily letters"}
        </p>
        <p className="text-[10px] text-muted-foreground leading-tight">
          {complete ? "Stretch goal: +1?" : `${goal - masteredToday} to go`}
        </p>
      </div>
    </div>
  );
};
