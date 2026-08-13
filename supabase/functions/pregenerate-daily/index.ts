/**
 * pregenerate-daily
 *
 * Pre-builds today's daily story for recently-active learners so that when
 * they open the app, `generate-daily-story` answers from cache instantly
 * instead of making them sit through a ~20-second generation. Intended to be
 * run on a schedule shortly after 00:00 UTC — `generate-daily-story` keys its
 * cache on the UTC date, so a story built at 00:15 UTC serves the whole day.
 *
 * Shares its generation core (_shared/dailyStory.ts) with the on-demand
 * function, so a pre-built story is byte-identical in shape to an on-demand
 * one and lands in the same `daily_vocab_stories` row the cache reads.
 *
 * Deliberately bounded: it prioritises the most recently active learners, and
 * stops at a batch cap and a time budget rather than trying to finish
 * everyone. Learners it does not reach lose nothing — they fall back to
 * on-demand generation, exactly as today. Run it more than once a night if
 * the active population outgrows one batch; already-built stories are skipped
 * per run, so repeated invocations walk further down the list.
 *
 * Invoke with the service-role key (a scheduled job) or as an admin.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  DailyStoryError,
  existingStory,
  generateDailyStoryFor,
  todayUtc,
  type DailyStoryDb,
} from "../_shared/dailyStory.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** "Recently active" means XP earned within this many days. */
const ACTIVE_WITHIN_DAYS = 3;

/** Stories generated per invocation unless the caller narrows it. */
const DEFAULT_BATCH = 10;

/**
 * Ceiling on the caller-requested batch. Each story is a full draft-critic
 * Brain round, so an unbounded batch is an unbounded AI bill from one request.
 */
const MAX_BATCH = 50;

/** How many active learners to even consider per run. */
const CANDIDATE_POOL = 200;

/**
 * Wall-clock budget. Edge functions are killed at 150s; stopping early turns
 * "the platform cut us off mid-story" into a clean count of who was reached.
 */
const TIME_BUDGET_MS = 100_000;

/**
 * Only the scheduler (service role) or an admin may run this. Same shape as
 * notify-due-reviews: not a data leak without it (the response is counts),
 * but each generated story is real model spend, so a stranger who knows the
 * URL must not be able to run up the bill.
 */
async function isAuthorised(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  if (token === SERVICE_ROLE) return true;

  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user) return false;
    const { data: role } = await supa
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    return !!role;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await isAuthorised(req))) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const storyDb = admin as unknown as DailyStoryDb;

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = !!body?.dryRun;
    const requested = Number(body?.batchSize);
    const batchSize = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_BATCH)
      : DEFAULT_BATCH;

    const today = todayUtc();
    const started = Date.now();
    const cutoff = new Date(Date.now() - ACTIVE_WITHIN_DAYS * 86_400_000).toISOString();

    // Most recently active first: the learner who practised an hour ago is
    // the most likely to open the app tomorrow morning.
    const { data: activeRows, error: activeErr } = await admin
      .from("user_xp")
      .select("user_id, updated_at")
      .gte("updated_at", cutoff)
      .order("updated_at", { ascending: false })
      .limit(CANDIDATE_POOL);
    if (activeErr) throw activeErr;

    const candidates = (activeRows ?? []) as Array<{ user_id: string }>;

    // One round trip for everyone's dialect; a learner with no profile row
    // (or no stated preference) gets the app's default.
    const dialectByUser = new Map<string, string>();
    if (candidates.length > 0) {
      const { data: profileRows } = await admin
        .from("profiles")
        .select("id, preferred_dialect")
        .in("id", candidates.map((c) => c.user_id));
      for (const row of (profileRows ?? []) as Array<{ id: string; preferred_dialect: string | null }>) {
        if (row.preferred_dialect) dialectByUser.set(row.id, row.preferred_dialect);
      }
    }

    let attempted = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;
    let outOfTime = false;

    for (const candidate of candidates) {
      if (attempted >= batchSize) break;
      if (Date.now() - started > TIME_BUDGET_MS) {
        outOfTime = true;
        break;
      }

      const dialect = dialectByUser.get(candidate.user_id) ?? "Gulf";

      // Already built — by an earlier run tonight, or by the learner opening
      // the app before we got here. Skips do not consume the batch.
      if (await existingStory(storyDb, candidate.user_id, dialect, today)) {
        skipped++;
        continue;
      }

      attempted++;
      if (dryRun) {
        generated++;
        continue;
      }

      try {
        await generateDailyStoryFor(storyDb, candidate.user_id, dialect, today);
        generated++;
      } catch (e) {
        // One learner's failure must not end the round for everyone after
        // them. DailyStoryError is already categorised; anything else is
        // logged the same way and counted the same way.
        failed++;
        const detail = e instanceof DailyStoryError ? `${e.code}: ${e.message}` : String(e);
        console.error("pregenerate-daily failed for user", candidate.user_id, detail.slice(0, 300));
      }
    }

    return new Response(
      JSON.stringify({
        date: today,
        candidates: candidates.length,
        attempted,
        generated,
        skipped,
        failed,
        outOfTime,
        dryRun,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("pregenerate-daily error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
