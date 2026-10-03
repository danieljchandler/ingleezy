import { useReviewStreak } from "@/hooks/useReviewStreak";
import { Art } from "@/components/brand/Art";
import { AR } from "@/lib/strings";
import { cn } from "@/lib/utils";

/**
 * The streak, as one of Today's two stat tiles: the flame, the number, and a
 * row of seven ticks for the days it is made of.
 *
 * The number is the run; the ticks are the last week, gold where a day was
 * kept (gold marks what you have earned) and ringed for today until it is.
 * The section is named with the full phrase ("سلسلة 4 أيام"), so the tile
 * reads as a sentence to a screen reader, not as a bare numeral.
 */
export function StreakCard({ className }: { className?: string }) {
  const { days, week } = useReviewStreak();

  return (
    <section
      aria-label={days > 0 ? AR.today.streakAlive(AR.streak.days(days)) : AR.today.streakNone}
      className={cn(
        "relative flex min-h-[132px] flex-col justify-end overflow-hidden rounded-3xl bg-card p-4 shadow-card",
        className,
      )}
    >
      <Art name="flame" eager className="absolute end-1.5 top-1.5 h-16 w-16" />
      <p className="font-display text-[40px] leading-[44px] tabular-nums">{days}</p>
      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
        {days > 0 ? AR.today.streakUnit(days) : AR.today.streakNone}
      </p>

      <ol aria-label={AR.today.lastSevenDays} className="mt-2.5 flex gap-1">
        {week.map((day) => (
          <li
            key={day.date}
            aria-label={day.done ? AR.today.dayDone : day.isToday ? AR.today.dayToday : undefined}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              day.done
                ? "bg-accent"
                : day.isToday
                  ? "bg-transparent ring-[1.5px] ring-inset ring-accent"
                  : "bg-muted",
            )}
          />
        ))}
      </ol>
    </section>
  );
}
