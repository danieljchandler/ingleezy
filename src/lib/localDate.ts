// Local-time date helpers. The app treats "today" and streak/week boundaries in
// the user's LOCAL timezone (see src/lib/todayCompletion.ts). Serializing with
// Date#toISOString() instead uses UTC, which shifts the day for users in
// negative-UTC offsets (the Americas) and makes date-keyed queries miss rows
// near midnight/week boundaries. Use these helpers to stay consistent.

/** Local-time `YYYY-MM-DD` key for a date (defaults to now). */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse a `YYYY-MM-DD` string as LOCAL midnight (not UTC midnight). */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * The Monday that starts this week, in UTC — the one deliberate exception to
 * everything above.
 *
 * `weekly_goals.week_start_date` is written only by `increment_review_count`
 * and `set_weekly_goal`, both security-definer functions that key it on
 * `date_trunc('week', now() AT TIME ZONE 'utc')::date`. Neither can know the
 * caller's timezone, so the week is the server's and every reader has to use
 * the same definition or it queries a row that was never written. Three
 * definitions were in play before this — a UTC Monday in the counter, a local
 * Monday in the reader, and a local SUNDAY in Onboarding and Settings — and the
 * goal a learner chose landed on a row the card did not read.
 *
 * Postgres weeks are ISO, so Sunday belongs to the week that began six days
 * earlier rather than starting a new one.
 */
export function utcWeekStart(now: Date = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekday = date.getUTCDay(); // 0 = Sunday
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return date.toISOString().slice(0, 10);
}
