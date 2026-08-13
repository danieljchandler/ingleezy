// Pure half of the voice-minute budget: tier allowances, report clamping and
// month-window arithmetic. Free of Deno globals and esm.sh imports so it can
// be unit-tested from the frontend Vitest suite
// (src/test/voiceBudgetCore.test.ts) while the IO half (voiceBudget.ts) stays
// a Deno edge-function module — the same split as learnerProfileCore.ts.
//
// Why minutes and not sessions: a session cap treats a 30-second call and a
// two-hour call as the same unit, while the upstream bills by the minute. The
// meter is what makes the cheapest tier's cost bounded.

export type VoiceTier = "free" | "standard" | "allin";

/**
 * Monthly voice allowance in seconds, per subscription tier. The numbers are a
 * product policy and deliberately easy to change; the mechanism is not.
 * Admins are unmetered and never consult this table.
 */
export const VOICE_MONTHLY_SECONDS: Record<VoiceTier, number> = {
  free: 30 * 60, // practice mode only — assistant mode is subscribers-only
  standard: 120 * 60,
  allin: 300 * 60,
};

/**
 * Ceiling on a single reported call. The client reports its own elapsed time,
 * so the value is clamped, never trusted: a forged report can cost its sender
 * at most one two-hour call, not a whole month.
 */
export const MAX_REPORT_SECONDS = 2 * 60 * 60;

/** Coerce a client-supplied duration into a safe integer number of seconds. */
export function clampReportedSeconds(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), MAX_REPORT_SECONDS);
}

/**
 * The UTC calendar-month window containing `now`, as ISO strings for a
 * created_at range query. UTC rather than the learner's timezone: the budget
 * is a billing boundary, not a study-day boundary, and it must mean the same
 * thing on every device the account signs in from.
 */
export function monthWindow(now: Date): { start: string; end: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString(),
    end: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

export function remainingSeconds(limitSeconds: number, usedSeconds: number): number {
  return Math.max(0, limitSeconds - Math.max(0, usedSeconds));
}
