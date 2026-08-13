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
