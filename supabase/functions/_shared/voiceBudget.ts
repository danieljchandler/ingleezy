// IO half of the voice-minute budget — reads and writes the voice_usage table
// under the service role. The arithmetic lives in voiceBudgetCore.ts so the
// Vitest suite can cover it; this module is Deno-only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { monthWindow } from "./voiceBudgetCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// One client per isolate, same as usageCap: this runs on the mint path of
// every voice call.
let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/**
 * Seconds of voice this user has consumed in the current UTC calendar month.
 * Fails open to 0: a broken meter must degrade to "not enforced", never to
 * "voice is down".
 */
export async function getMonthUsedSeconds(userId: string, now: Date = new Date()): Promise<number> {
  try {
    const { start, end } = monthWindow(now);
    const { data, error } = await admin()
      .from("voice_usage")
      .select("seconds")
      .eq("user_id", userId)
      .gte("created_at", start)
      .lt("created_at", end);
    if (error) {
      console.warn("[voiceBudget] usage query failed:", error.message);
      return 0;
    }
    const rows = (data ?? []) as Array<{ seconds: unknown }>;
    return rows.reduce((sum, row) => {
      const s = typeof row.seconds === "number" ? row.seconds : Number(row.seconds);
      return sum + (Number.isFinite(s) && s > 0 ? s : 0);
    }, 0);
  } catch (e) {
    console.warn("[voiceBudget] usage query threw:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * Record a finished call. Callers pass already-clamped seconds
 * (voiceBudgetCore.clampReportedSeconds); zero-length calls are dropped here
 * rather than stored. Errors are logged and swallowed — losing one usage row
 * is better than failing the learner's teardown request.
 */
export async function recordVoiceUsage(
  userId: string,
  mode: "practice" | "assistant",
  seconds: number,
): Promise<void> {
  if (seconds <= 0) return;
  try {
    const { error } = await admin()
      .from("voice_usage")
      .insert([{ user_id: userId, mode, seconds }]);
    if (error) console.warn("[voiceBudget] insert failed:", error.message);
  } catch (e) {
    console.warn("[voiceBudget] insert threw:", e instanceof Error ? e.message : e);
  }
}
