/**
 * Structured feature metrics sink for edge functions.
 * Writes to public.feature_metrics. Fails silently — never throws.
 *
 * Use this for diagnostic signals you want to slice by feature/dialect
 * in the admin UI: Firecrawl result counts, AI parse errors, dialect
 * leak scores, generation durations, etc.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

export type MetricStatus = "ok" | "warn" | "error";

export interface MetricInput {
  /** Feature/area, e.g. "souq-news", "phrase-of-the-day", "ai-brain". */
  feature: string;
  /** Event name, e.g. "firecrawl_search", "json_parse", "dialect_leak". */
  event: string;
  /** Active dialect for this event, when applicable. */
  dialect?: string | null;
  status?: MetricStatus;
  /** Wall-clock ms for the operation. */
  durationMs?: number | null;
  /** Generic count (e.g. articles returned, leaks found). */
  count?: number | null;
  /** Generic numeric score (e.g. dialect quality, leak rate). */
  score?: number | null;
  userId?: string | null;
  /** Arbitrary structured context. Kept small. */
  meta?: Record<string, unknown>;
}

let client: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export async function logMetric(input: MetricInput): Promise<void> {
  try {
    const supa = getClient();
    if (!supa) return;
    await supa.from("feature_metrics").insert({
      feature: input.feature,
      event: input.event,
      dialect: input.dialect ?? null,
      status: input.status ?? "ok",
      duration_ms: input.durationMs ?? null,
      count: input.count ?? null,
      score: input.score ?? null,
      user_id: input.userId ?? null,
      meta: (input.meta ?? {}) as never,
    });
  } catch {
    /* swallow */
  }
}

/** Fire-and-forget helper for non-blocking call sites. */
export function emitMetric(input: MetricInput): void {
  void logMetric(input);
}
