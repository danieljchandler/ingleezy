import { localDateKey } from "@/lib/localDate";

/**
 * What a learner's streak is *worth right now*, as opposed to what the row
 * happens to say.
 *
 * `review_streaks` is only written when a review completes, which is the only
 * thing that can extend a streak. Nothing writes it when one *ends* — ending is
 * the absence of an event, and no amount of server-side bookkeeping produces a
 * row update for a day on which a learner did nothing.
 *
 * So the stored `current_streak` goes stale the moment a day is missed, and it
 * stays stale until the next review resets it. A learner who was on eleven days
 * and then skipped Tuesday reopens the app on Wednesday to a confident orange
 * "11" — a number that is already wrong, sitting in the header of every screen.
 * That is worse than showing nothing: it tells them the run they have just
 * broken is intact, and they find out only after reviewing.
 *
 * The fix is to derive rather than to expire. Every reader asks this, and the
 * stored row stays a record of the last completed run.
 *
 * Alive means the last recorded day is today or yesterday:
 *
 * - **today** — already reviewed; the run is current.
 * - **yesterday** — not reviewed yet today, and that is not a break. A streak
 *   is broken by a day passing with nothing in it, so today only counts against
 *   them once it is over. Showing zero at 9am for someone who reviewed at 11pm
 *   last night would be its own kind of lie.
 * - anything earlier — a whole day went by untouched. The run is over.
 *
 * A date *later* than today also counts as alive rather than as nonsense:
 * `record_review_day` clamps what it is given to a day either side of the
 * server's own date, so a learner far enough east can legitimately hold a row
 * dated tomorrow by their device's reckoning.
 */
export function effectiveStreak(
  row: { current_streak?: number | null; last_review_date?: string | null } | null | undefined,
  today: string = localDateKey(),
): number {
  if (!row?.last_review_date) return 0;

  const current = Number(row.current_streak ?? 0);
  if (current <= 0) return 0;

  // `YYYY-MM-DD` strings compare correctly as strings, which avoids parsing two
  // dates and the timezone question that comes with it.
  return row.last_review_date >= dayBefore(today) ? current : 0;
}

/** The day before a `YYYY-MM-DD` key, as another `YYYY-MM-DD` key. */
function dayBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) - 1);
  return localDateKey(date);
}

/** The columns every caller of `effectiveStreak` has to select. */
export const STREAK_COLUMNS = "current_streak, longest_streak, last_review_date";
