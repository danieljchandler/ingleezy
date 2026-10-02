import { Check, Zap } from "lucide-react";
import { useReviewStreak } from "@/hooks/useReviewStreak";
import { AR } from "@/lib/strings";
import { cn } from "@/lib/utils";

/**
 * The streak, and the last seven days it is made of.
 *
 * One number and one row of days. It replaced a welcome panel that carried a
 * streak chip and a weekly XP ring, beside two more rings further down the
 * page — three progress figures that disagreed with each other. The plan card
 * is now the only measure of *today*; this is the only measure of *the run*.
 */
export function StreakCard({ className }: { className?: string }) {
  const { days, week } = useReviewStreak();

  return (
    <section
      aria-label={AR.streak.label}
      className={cn("rounded-3xl bg-card p-4 shadow-card", className)}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            days > 0 ? "bg-accent text-secondary" : "bg-muted text-muted-foreground",
          )}
        >
          <Zap className="h-[18px] w-[18px] fill-current" aria-hidden />
        </span>
        <p className="text-[17px] font-semibold leading-[26px]">
          {days > 0 ? AR.today.streakAlive(AR.streak.days(days)) : AR.today.streakNone}
        </p>
      </div>

      <ol aria-label={AR.today.lastSevenDays} className="mt-3.5 grid grid-cols-7">
        {week.map((day) => (
          <li key={day.date} className="flex flex-col items-center gap-1.5">
            <span
              className={cn(
                "text-xs leading-4",
                day.isToday ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              {day.label}
            </span>
            <span
              aria-label={day.done ? AR.today.dayDone : day.isToday ? AR.today.dayToday : undefined}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-full",
                day.done
                  ? "bg-primary text-primary-foreground"
                  : day.isToday
                    ? "border-2 border-dashed border-primary bg-card"
                    : "bg-muted",
              )}
            >
              {day.done && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
