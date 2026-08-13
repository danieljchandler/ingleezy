// Fire-and-forget cost telemetry: one row per upstream model call into
// `llm_usage_logs`, carrying the token counts and provider-reported cost the
// response already contained. Never throws, never awaited on the request path
// — losing a telemetry row must not fail the learner's request. Same sink
// shape as msaViolationLogger.ts.
//
// The pure extraction half is llmUsageCore.ts, unit-tested from Vitest.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { hasUsage, type NormalizedUsage } from './llmUsageCore.ts';

interface LogArgs {
  /** The Brain task's purpose or the edge function's name. */
  functionName: string;
  model: string;
  provider: 'openrouter' | 'lovable' | string;
  usage: NormalizedUsage;
  userId?: string | null;
  /** For non-LLM legs: what was consumed and what `units` counts. */
  units?: number | null;
  unitKind?: 'characters' | 'seconds' | 'images' | null;
}

let cached: ReturnType<typeof createClient> | null = null;
function client() {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export function logLlmUsage(args: LogArgs): void {
  try {
    // A row with nothing quantitative in it is noise, not telemetry.
    if (!hasUsage(args.usage) && args.units == null) return;
    const sb = client();
    if (!sb) return;
    sb.from('llm_usage_logs')
      .insert([
        {
          function_name: args.functionName,
          llm_used: args.model,
          provider: args.provider,
          prompt_tokens: args.usage.promptTokens,
          completion_tokens: args.usage.completionTokens,
          cached_tokens: args.usage.cachedTokens,
          cost_usd: args.usage.costUsd,
          units: args.units ?? null,
          unit_kind: args.unitKind ?? null,
          user_id: args.userId ?? null,
        },
        // The service-role client is untyped here, same as every sink.
      ] as unknown as never)
      .then(
        ({ error }: { error: { message: string } | null }) => {
          if (error) console.warn('[llmUsageLogger] insert failed:', error.message);
        },
        (err: unknown) => console.warn('[llmUsageLogger] insert threw:', err),
      );
  } catch (e) {
    console.warn('[llmUsageLogger] failed:', e instanceof Error ? e.message : e);
  }
}
