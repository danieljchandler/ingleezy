// Aggregates MSA leak violations from the last N days for admin review.
// Returns: per-dialect counts, top offending MSA tokens, top source functions,
// recent unresolved samples. Optionally filters by dialect.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getCorsHeaders } from "../_shared/cors.ts";

interface ReqBody {
  dialect?: string;
  days?: number;
  includeResolved?: boolean;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Closes over this request's CORS headers. As a module-level function it
  // referenced `corsHeaders` from an enclosing scope that does not exist there,
  // so every response — including the success path — threw a ReferenceError
  // before it could be sent.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing auth' }, 401);
    }

    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supaUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Invalid auth' }, 401);

    const { data: isAdminData } = await userClient.rpc('has_role', {
      _user_id: userData.user.id,
      _role: 'admin',
    });
    if (!isAdminData) return json({ error: 'Admin only' }, 403);

    const body: ReqBody = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const days = Math.max(1, Math.min(90, body.days ?? 7));
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const admin = createClient(supaUrl, svcKey, { auth: { persistSession: false } });

    let q = admin
      .from('dialect_rule_violations')
      .select('id, dialect, msa_token, offending_text, source_function, detected_by, resolved, metadata, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (body.dialect) q = q.eq('dialect', body.dialect);
    if (!body.includeResolved) q = q.eq('resolved', false);

    const { data: rows, error } = await q;
    if (error) return json({ error: error.message }, 500);

    const all = rows ?? [];
    const byDialect: Record<string, number> = {};
    const byToken: Record<string, number> = {};
    const byFunction: Record<string, number> = {};

    for (const r of all) {
      byDialect[r.dialect] = (byDialect[r.dialect] ?? 0) + 1;
      if (r.msa_token) byToken[r.msa_token] = (byToken[r.msa_token] ?? 0) + 1;
      if (r.source_function) byFunction[r.source_function] = (byFunction[r.source_function] ?? 0) + 1;
    }

    const topTokens = Object.entries(byToken)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([token, count]) => ({ token, count }));

    const topFunctions = Object.entries(byFunction)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([fn, count]) => ({ fn, count }));

    const samples = all.slice(0, 30).map((r) => ({
      id: r.id,
      dialect: r.dialect,
      token: r.msa_token,
      function: r.source_function,
      created_at: r.created_at,
      snippet: (r.offending_text ?? '').slice(0, 280),
      resolved: r.resolved,
    }));

    // The flywheel's weekly pulse: corrections banked in the window, by tier
    // and dialect, plus minutes of gold audio accumulated. Failure here
    // degrades to an absent section, never a failed digest.
    let flywheel: Record<string, unknown> | null = null;
    try {
      const { data: teRows } = await admin
        .from('training_examples')
        .select('dialect, tier, task_type, audio_start_ms, audio_end_ms, audio_path')
        .gte('created_at', since)
        .limit(5000);
      const te = (teRows ?? []) as Array<{
        dialect: string;
        tier: string;
        task_type: string;
        audio_start_ms: number | null;
        audio_end_ms: number | null;
        audio_path: string | null;
      }>;
      const byTier: Record<string, number> = {};
      const goldAudioMsByDialect: Record<string, number> = {};
      for (const r of te) {
        byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
        if (r.tier === 'gold' && r.audio_path && r.audio_start_ms != null && r.audio_end_ms != null) {
          goldAudioMsByDialect[r.dialect] =
            (goldAudioMsByDialect[r.dialect] ?? 0) + Math.max(0, r.audio_end_ms - r.audio_start_ms);
        }
      }
      flywheel = {
        examples: te.length,
        byTier,
        goldAudioMinutesByDialect: Object.fromEntries(
          Object.entries(goldAudioMsByDialect).map(([d, ms]) => [d, Math.round(ms / 60_000)]),
        ),
      };
    } catch (e) {
      console.warn('[dialect-violations-digest] flywheel section failed:', e);
    }

    return json({
      windowDays: days,
      totals: { all: all.length, byDialect },
      topTokens,
      topFunctions,
      samples,
      flywheel,
    });
  } catch (err) {
    console.error('[dialect-violations-digest] error', err);
    return json({ error: String(err) }, 500);
  }
});
