// Snapshot-sync published videos from Hakiya into local discover_videos.
//
// Hakiya (the Arabic-learning sibling app this repo was forked from) exposes
// its published discover_videos rows to any client holding its public anon
// key — the RLS policy is `published = true OR is_admin()`. This function
// pulls that snapshot and upserts it locally with source='hakiya', keeping
// Hakiya's UUIDs as primary keys so re-syncs are idempotent updates, not
// duplicates.
//
// Why snapshot rather than querying Hakiya live from the client: the two
// products stay independently deployable, Hakiya schema drift degrades to
// stale content here instead of runtime errors, and the learner never waits
// on a second backend.
//
// For Ingleezy's learners the bridged rows are secondary content: Arabic
// dialect speech whose transcript lines already carry natural English
// (`translation`), a word-order gloss (`literal`) and — since Hakiya PR
// #252 — a Fusha line. The learner surface renders English primary and the
// Arabic lines as scaffold.
//
// Admin-only (mirrors record-transcript-corrections): syncing writes
// content learners will see.
//
// Env: HAKIYA_SUPABASE_URL, HAKIYA_SUPABASE_ANON_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** The columns copied verbatim when present. Anything Hakiya adds later is
 *  ignored; anything it removes simply stops updating — drift never throws. */
const COPIED_COLUMNS = [
  "title",
  "title_arabic",
  "source_url",
  "platform",
  "embed_url",
  "thumbnail_url",
  "duration_seconds",
  "dialect",
  "difficulty",
  "cefr_level",
  "transcript_lines",
  "vocabulary",
  "grammar_points",
  "cultural_context",
] as const;

const MAX_LIMIT = 500;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Admin only ──────────────────────────────────────────────────────────
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return json({ error: "auth_required" }, 401, corsHeaders);

    const { data: userData, error: userErr } = await admin().auth.getUser(token);
    const userId = userData?.user?.id;
    if (userErr || !userId) return json({ error: "auth_required" }, 401, corsHeaders);

    const { data: roles } = await admin()
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin");
    if (!roles?.length) return json({ error: "forbidden" }, 403, corsHeaders);

    const hakiyaUrl = Deno.env.get("HAKIYA_SUPABASE_URL");
    const hakiyaKey = Deno.env.get("HAKIYA_SUPABASE_ANON_KEY");
    if (!hakiyaUrl || !hakiyaKey) {
      return json(
        { error: "bridge_not_configured", detail: "HAKIYA_SUPABASE_URL / HAKIYA_SUPABASE_ANON_KEY missing" },
        503,
        corsHeaders,
      );
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 200) || 200, MAX_LIMIT);

    // ── Pull Hakiya's published, non-meme videos ────────────────────────────
    const params = new URLSearchParams({
      select: ["id", ...COPIED_COLUMNS].join(","),
      published: "eq.true",
      is_meme: "eq.false",
      order: "created_at.desc",
      limit: String(limit),
    });
    const resp = await fetch(`${hakiyaUrl}/rest/v1/discover_videos?${params}`, {
      headers: { apikey: hakiyaKey, Authorization: `Bearer ${hakiyaKey}` },
    });
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 300);
      return json({ error: "hakiya_fetch_failed", status: resp.status, detail }, 502, corsHeaders);
    }
    const remote = (await resp.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(remote)) {
      return json({ error: "hakiya_fetch_failed", detail: "non-array response" }, 502, corsHeaders);
    }

    // ── Map to local rows, defensively ──────────────────────────────────────
    const rows: Array<Record<string, unknown>> = [];
    let skipped = 0;
    for (const r of remote) {
      // Without an id the upsert can't be idempotent; without an embed_url
      // the player has nothing to show. Both are drift signals, not errors.
      if (typeof r.id !== "string" || typeof r.embed_url !== "string" || !r.embed_url) {
        skipped++;
        continue;
      }
      const row: Record<string, unknown> = {
        id: r.id,
        source: "hakiya",
        published: true,
        created_by: userId,
      };
      for (const col of COPIED_COLUMNS) {
        if (r[col] !== undefined) row[col] = r[col];
      }
      rows.push(row);
    }

    let synced = 0;
    if (rows.length > 0) {
      const { error } = await admin()
        .from("discover_videos")
        .upsert(rows, { onConflict: "id" });
      if (error) return json({ error: "upsert_failed", detail: error.message }, 500, corsHeaders);
      synced = rows.length;
    }

    console.log(`[sync-hakiya-videos] synced=${synced} skipped=${skipped} of ${remote.length}`);
    return json({ success: true, synced, skipped, fetched: remote.length }, 200, corsHeaders);
  } catch (e) {
    console.error("[sync-hakiya-videos]", e);
    return json({ error: "internal", detail: String(e).slice(0, 300) }, 500, getCorsHeaders(req));
  }
});
