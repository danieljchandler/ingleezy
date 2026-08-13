/**
 * Lightweight client-side error sink.
 *
 * Sends errors to the `client_errors` table. After the security hardening
 * migration, INSERT is restricted to authenticated users — anon errors are
 * dropped silently. Rate-limited to 10 errors per 60-second window per session
 * to prevent runaway loops from flooding the table. Fails silently — never
 * throws from inside the logger.
 */
import { supabase } from "@/integrations/supabase/client";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
let bucket: number[] = [];

function withinRateLimit(): boolean {
  const now = Date.now();
  bucket = bucket.filter((t) => now - t < WINDOW_MS);
  if (bucket.length >= MAX_PER_WINDOW) return false;
  bucket.push(now);
  return true;
}

function truncate(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) : s;
}

export interface LogErrorInput {
  message: string;
  stack?: string | null;
  source?: "client" | "edge";
  route?: string | null;
  meta?: Record<string, unknown>;
}

export async function logClientError(input: LogErrorInput): Promise<void> {
  try {
    if (!withinRateLimit()) return;
    const route =
      input.route ??
      (typeof window !== "undefined" ? window.location.pathname + window.location.search : null);
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

    // Resolve user_id — drop the log if unauthenticated (RLS forbids it).
    let userId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id ?? null;
    } catch {
      /* ignore */
    }
    if (!userId) return;

    await supabase.from("client_errors").insert({
      user_id: userId,
      source: input.source ?? "client",
      route: truncate(route, 500),
      message: truncate(input.message, 2000) ?? "(empty)",
      stack: truncate(input.stack ?? null, 8000),
      user_agent: truncate(ua, 500),
      meta: (input.meta ?? {}) as never,
    });
  } catch {
    /* never throw from a logger */
  }
}
