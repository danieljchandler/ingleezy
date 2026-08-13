// The flywheel's W1 capture point (docs/improvement-plan-2026-08.md): called
// by the admin video form just before it overwrites transcript_lines. Diffs
// the incoming lines against what is stored — server-side, so nobody can
// forge training rows from a browser — and writes every changed line into
// training_examples as an audio-aligned correction pair.
//
// Best-effort by design: the save must succeed even when capture fails, so
// every failure here is a warn and a count, never a thrown save.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  diffTranscriptLines,
  normalizeDialect,
} from "../_shared/transcriptDiffCore.ts";

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

/** The staged-audio naming convention process-approved-video uses. */
const AUDIO_EXTENSIONS = ["wav", "mp4", "m4a", "webm", "mp3", "opus"];

/** Find the video's audio object in the video-audio bucket, if one exists. */
async function findAudioPath(videoId: string): Promise<string | null> {
  try {
    const { data, error } = await admin().storage
      .from("video-audio")
      .list("", { search: videoId, limit: 10 });
    if (error || !data) return null;
    const names = new Set(data.map((o: { name: string }) => o.name));
    for (const ext of AUDIO_EXTENSIONS) {
      if (names.has(`${videoId}.${ext}`)) return `${videoId}.${ext}`;
    }
    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Who is correcting? Only content staff produce training data. ────────
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
      .in("role", ["admin", "content_reviewer"]);
    const roleSet = new Set(((roles ?? []) as Array<{ role: string }>).map((r) => r.role));
    if (roleSet.size === 0) return json({ error: "forbidden" }, 403, corsHeaders);
    // A content_reviewer is the native-speaker seat in the RBAC model, so
    // their edits are gold; an admin's are silver.
    const isReviewer = roleSet.has("content_reviewer");
    const tier = isReviewer ? "gold" : "silver";
    const correctorRole = isReviewer ? "content_reviewer" : "admin";

    // ── What changed? ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    const newLines = body.lines;
    if (!videoId || !Array.isArray(newLines)) {
      return json({ error: "videoId and lines are required" }, 400, corsHeaders);
    }

    const { data: video, error: videoErr } = await admin()
      .from("discover_videos")
      .select("id, dialect, transcript_lines, engines_used")
      .eq("id", videoId)
      .maybeSingle();
    if (videoErr || !video) return json({ error: "video not found" }, 404, corsHeaders);

    const dialect = normalizeDialect((video as { dialect?: unknown }).dialect);
    if (!dialect) {
      // A skipped capture beats a mislabeled training row.
      return json({ recorded: 0, skipped: "unrecognized dialect" }, 200, corsHeaders);
    }

    const pairs = diffTranscriptLines(
      (video as { transcript_lines?: unknown }).transcript_lines,
      newLines,
    );
    if (pairs.length === 0) return json({ recorded: 0 }, 200, corsHeaders);

    const audioPath = await findAudioPath(videoId);
    const engines = (video as { engines_used?: unknown }).engines_used ?? null;

    const rows = pairs.map((pair) => ({
      task_type: pair.kind === "asr" ? "asr" : "translation",
      dialect,
      machine_output: pair.before,
      human_output: pair.after,
      context: {
        counterpart: pair.counterpart,
        // The stored lines are machine output until a human first edits them;
        // after that, a pair records a refinement of an earlier human pass.
        prior: "stored_lines",
      },
      audio_bucket: pair.kind === "asr" && audioPath ? "video-audio" : null,
      audio_path: pair.kind === "asr" ? audioPath : null,
      audio_start_ms: pair.startMs,
      audio_end_ms: pair.endMs,
      source_table: "discover_videos",
      source_id: videoId,
      source_function: "record-transcript-corrections",
      engines,
      corrector_role: correctorRole,
      corrector_id: userId,
      tier,
      source_license: "platform_media",
    }));

    const { error: insertErr } = await admin()
      .from("training_examples")
      .insert(rows as unknown as never);
    if (insertErr) {
      console.warn("[record-transcript-corrections] insert failed:", insertErr.message);
      return json({ recorded: 0, error: insertErr.message }, 200, corsHeaders);
    }

    return json({ recorded: rows.length }, 200, corsHeaders);
  } catch (e) {
    console.error("[record-transcript-corrections] error", e);
    return json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
      corsHeaders,
    );
  }
});
