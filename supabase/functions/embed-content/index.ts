// Populates the semantic content index (content_embeddings) — Sprint 3's B1.
// Admin-triggered and incremental: each run embeds a bounded slice of
// whatever isn't indexed yet, so backfilling is "call it until it returns
// embedded: 0" and keeping fresh is a periodic call with a small limit.
//
// Kinds:
//   video_line       one row per transcript line of a published video, Arabic
//                    plus translation embedded together so English queries
//                    land on Arabic content; audio offsets live on the line.
//   vocabulary_word  curriculum vocabulary (word + gloss).
//
// Degrades cleanly on a database without pgvector: the first insert fails,
// the run reports the error, nothing else breaks (the migration that creates
// content_embeddings is guarded the same way).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { embedTexts } from "../_shared/embeddings.ts";
import { normalizeDialect } from "../_shared/transcriptDiffCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Candidate {
  kind: "video_line" | "vocabulary_word";
  source_id: string;
  chunk_index: number;
  dialect: string;
  content: string;
}

/** Keys already embedded for a set of source ids, to diff against. */
async function existingKeys(kind: string, sourceIds: string[]): Promise<Set<string>> {
  if (sourceIds.length === 0) return new Set();
  const { data, error } = await admin()
    .from("content_embeddings")
    .select("source_id, chunk_index")
    .eq("kind", kind)
    .in("source_id", sourceIds);
  if (error) throw new Error(`content_embeddings lookup failed: ${error.message}`);
  return new Set(
    ((data ?? []) as Array<{ source_id: string; chunk_index: number }>).map(
      (r) => `${r.source_id}:${r.chunk_index}`,
    ),
  );
}

async function videoLineCandidates(limit: number): Promise<Candidate[]> {
  // Newest published videos first; the per-run video cap bounds the work.
  const { data, error } = await admin()
    .from("discover_videos")
    .select("id, dialect, transcript_lines")
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`discover_videos fetch failed: ${error.message}`);

  const videos = (data ?? []) as Array<{ id: string; dialect: unknown; transcript_lines: unknown }>;
  const seen = await existingKeys("video_line", videos.map((v) => v.id));

  const out: Candidate[] = [];
  for (const video of videos) {
    const dialect = normalizeDialect(video.dialect);
    if (!dialect || !Array.isArray(video.transcript_lines)) continue;
    video.transcript_lines.forEach((raw, index) => {
      if (seen.has(`${video.id}:${index}`)) return;
      const line = raw as { arabic?: unknown; translation?: unknown };
      const arabic = typeof line.arabic === "string" ? line.arabic.trim() : "";
      if (!arabic) return;
      const translation = typeof line.translation === "string" ? line.translation.trim() : "";
      out.push({
        kind: "video_line",
        source_id: video.id,
        chunk_index: index,
        dialect,
        content: translation ? `${arabic}\n${translation}` : arabic,
      });
    });
  }
  return out;
}

async function vocabularyCandidates(limit: number): Promise<Candidate[]> {
  const { data, error } = await admin()
    .from("vocabulary_words")
    .select("id, word_arabic, word_english, dialect_module")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`vocabulary_words fetch failed: ${error.message}`);

  const words = (data ?? []) as Array<{
    id: string;
    word_arabic: unknown;
    word_english: unknown;
    dialect_module: unknown;
  }>;
  const seen = await existingKeys("vocabulary_word", words.map((w) => w.id));

  const out: Candidate[] = [];
  for (const word of words) {
    if (seen.has(`${word.id}:0`)) continue;
    const dialect = normalizeDialect(word.dialect_module);
    const arabic = typeof word.word_arabic === "string" ? word.word_arabic.trim() : "";
    if (!dialect || !arabic) continue;
    const english = typeof word.word_english === "string" ? word.word_english.trim() : "";
    out.push({
      kind: "vocabulary_word",
      source_id: word.id,
      chunk_index: 0,
      dialect,
      content: english ? `${arabic}\n${english}` : arabic,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Admin only — this spends embedding tokens on the whole content library.
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return json({ error: "auth_required" }, 401, corsHeaders);
    const { data: userData, error: userErr } = await admin().auth.getUser(token);
    if (userErr || !userData?.user?.id) return json({ error: "auth_required" }, 401, corsHeaders);
    const { data: roles } = await admin()
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin");
    if (!roles || (roles as unknown[]).length === 0) {
      return json({ error: "admin_required" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const kind = typeof body.kind === "string" ? body.kind : "all";
    // Source rows examined per run, not vectors written — a video can carry
    // dozens of lines. Bounded so a run always finishes inside the runtime.
    const limit = Math.max(1, Math.min(200, Number(body.limit) || 25));

    let candidates: Candidate[] = [];
    if (kind === "video_line" || kind === "all") {
      candidates = candidates.concat(await videoLineCandidates(limit));
    }
    if (kind === "vocabulary_word" || kind === "all") {
      candidates = candidates.concat(await vocabularyCandidates(limit * 4));
    }

    // One run's vector budget; the caller loops until embedded: 0.
    candidates = candidates.slice(0, 500);
    if (candidates.length === 0) {
      return json({ embedded: 0, note: "nothing new to embed" }, 200, corsHeaders);
    }

    const vectors = await embedTexts(candidates.map((c) => c.content));
    const rows = candidates.map((c, i) => ({ ...c, embedding: vectors[i] }));

    const { error: insertErr } = await admin()
      .from("content_embeddings")
      .insert(rows as unknown as never);
    if (insertErr) {
      // The likeliest cause on a fresh database: pgvector absent, table never
      // created. Reported plainly rather than thrown — the caller learns the
      // real state either way.
      return json({ embedded: 0, error: insertErr.message }, 200, corsHeaders);
    }

    const byKind: Record<string, number> = {};
    for (const c of candidates) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    return json({ embedded: rows.length, byKind }, 200, corsHeaders);
  } catch (e) {
    console.error("[embed-content] error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
