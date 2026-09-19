// ingest-from-library — the push half of the content-library bridge.
//
// Maktaba (the standalone content library; docs/content-library-bridge.md)
// sends an English-language item here to be transcribed. This creates the
// discover_videos row with attribution the app has never recorded
// (creator_name / creator_handle / library_item_id), stages any audio the
// library already mirrored where process-english-video's acquisition ladder
// looks first, and kicks that pipeline under the service-role key.
//
// The caller is another app, not a user: auth is the x-library-secret header
// checked in constant time against LIBRARY_BRIDGE_SECRET (`hasSharedSecret`
// in the ported _shared/requireRole.ts). config.toml sets verify_jwt = false
// because the check is the secret, not the gateway.
//
// `{ action: "status", remote_id }` is the read side: transcription status,
// and once complete the transcript's English for the library's search.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasSharedSecret } from "../_shared/requireRole.ts";

const SECRET_HEADER = "x-library-secret";
const SECRET_ENV = "LIBRARY_BRIDGE_SECRET";
const MAX_AUDIO_BYTES = 60 * 1024 * 1024;

/** The learner's scaffold dialect, which for an English clip is the library's guess at the audience. */
const DIALECTS: Record<string, string> = { gulf: "Gulf", khaliji: "Gulf", egyptian: "Egyptian", masri: "Egyptian", yemeni: "Yemeni" };

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function escapeLikePattern(literal: string): string {
  return literal.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function parseVideoUrl(url: string): { platform: string; videoId: string; embedUrl: string; canonicalUrl: string } | null {
  const tt = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/) ?? url.match(/tiktok\.com\/(?:video|embed\/v2|player\/v1|v)\/(\d{8,})/);
  if (tt) return { platform: "tiktok", videoId: tt[1], embedUrl: `https://www.tiktok.com/player/v1/${tt[1]}`, canonicalUrl: url.split("?")[0] };
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { platform: "youtube", videoId: yt[1], embedUrl: `https://www.youtube-nocookie.com/embed/${yt[1]}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1`, canonicalUrl: `https://www.youtube.com/watch?v=${yt[1]}` };
  const ig = url.match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
  if (ig) return { platform: "instagram", videoId: ig[1], embedUrl: `https://www.instagram.com/p/${ig[1]}/embed`, canonicalUrl: `https://www.instagram.com/reel/${ig[1]}/` };
  return null;
}

/** The English side of the transcript — this app's line shape is { english, arabic, fusha, literal }. */
function transcriptText(lines: unknown): string {
  if (!Array.isArray(lines)) return "";
  return lines.map((l) => (l && typeof l === "object" ? String((l as { english?: unknown }).english ?? "") : "")).filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  if (!(await hasSharedSecret(req, SECRET_HEADER, SECRET_ENV))) {
    return json({ error: "forbidden", message: `Missing or wrong ${SECRET_HEADER}.` }, 401, cors);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const body = await req.json().catch(() => ({}));

  try {
    if (body?.action === "status") {
      const remoteId = typeof body.remote_id === "string" ? body.remote_id : "";
      if (!remoteId) return json({ error: "remote_id required" }, 400, cors);
      const { data: row } = await sb
        .from("discover_videos")
        .select("id, transcription_status, transcription_error, transcript_lines, duration_seconds, published, title")
        .eq("id", remoteId)
        .maybeSingle();
      if (!row) return json({ error: "not_found" }, 404, cors);
      const status = row.transcription_status === "completed" ? "completed" : row.transcription_status === "failed" ? "failed" : "processing";
      return json({
        remote_id: row.id, status, error: row.transcription_error ?? null, published: row.published, title: row.title,
        duration_seconds: row.duration_seconds, transcript_text: status === "completed" ? transcriptText(row.transcript_lines) : null,
      }, 200, cors);
    }

    const libraryItemId = typeof body?.library_item_id === "string" ? body.library_item_id : null;
    const rawUrl = typeof body?.source_url === "string" ? body.source_url.trim() : "";
    if (!libraryItemId || !/^https?:\/\//i.test(rawUrl)) {
      return json({ error: "invalid_request", message: "library_item_id and an http(s) source_url are required." }, 400, cors);
    }
    const parsed = parseVideoUrl(rawUrl);
    if (!parsed) return json({ error: "unsupported_url", message: "Only TikTok, YouTube and Instagram videos can be transcribed here." }, 400, cors);

    // Rows are attributed to a real account, so `created_by` is never a
    // fabricated id: there is no user session on this door, and inserting a
    // placeholder would leave content in the catalogue owned by nobody.
    const bridgeUserId = Deno.env.get("LIBRARY_BRIDGE_USER_ID");
    if (!bridgeUserId) {
      return json({ error: "bridge_not_configured", message: "LIBRARY_BRIDGE_USER_ID is not set." }, 503, cors);
    }

    const dialect = DIALECTS[String(body.dialect ?? "").toLowerCase()] ?? "Gulf";
    const creatorName = typeof body.creator_name === "string" ? body.creator_name.slice(0, 120) : null;
    const creatorHandle = typeof body.creator_handle === "string" ? body.creator_handle.replace(/^@/, "").slice(0, 80) : null;

    const { data: byLibrary } = await sb.from("discover_videos").select("id, transcription_status").eq("library_item_id", libraryItemId).limit(1).maybeSingle();
    const { data: byVideo } = byLibrary ? { data: null } : await sb
      .from("discover_videos").select("id, transcription_status").eq("platform", parsed.platform)
      .ilike("source_url", `%${escapeLikePattern(parsed.videoId)}%`).limit(1).maybeSingle();
    const existing = byLibrary ?? byVideo;
    if (existing) {
      if (!byLibrary) {
        await sb.from("discover_videos").update({ library_item_id: libraryItemId, ...(creatorName ? { creator_name: creatorName } : {}), ...(creatorHandle ? { creator_handle: creatorHandle } : {}) }).eq("id", existing.id);
      }
      return json({ remote_id: existing.id, remote_url: `/admin/videos/${existing.id}/edit`, status: existing.transcription_status === "completed" ? "completed" : "exists" }, 200, cors);
    }

    const fallbackTitle = `${parsed.platform === "tiktok" ? "TikTok" : parsed.platform === "youtube" ? "YouTube" : "Instagram"} ${parsed.videoId}`;
    const { data: inserted, error: insertErr } = await sb
      .from("discover_videos")
      .insert({
        title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : fallbackTitle,
        title_arabic: typeof body.title_native === "string" && body.title_native.trim() ? body.title_native.trim().slice(0, 200) : null,
        source_url: parsed.canonicalUrl,
        platform: parsed.platform,
        embed_url: parsed.embedUrl,
        thumbnail_url: typeof body.thumbnail_url === "string" && body.thumbnail_url ? body.thumbnail_url : null,
        dialect,
        difficulty: "Intermediate",
        published: false,
        created_by: bridgeUserId,
        transcription_status: "pending",
        is_meme: false,
        source: "maktaba",
        library_item_id: libraryItemId,
        creator_name: creatorName,
        creator_handle: creatorHandle,
        duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : null,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) return json({ error: "insert_failed", detail: insertErr?.message }, 500, cors);
    const videoId = inserted.id as string;

    let audioStaged = false;
    if (typeof body.audio_url === "string" && body.audio_url) {
      try {
        const resp = await fetch(body.audio_url, { signal: AbortSignal.timeout(60_000) });
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          if (buf.byteLength > 0 && buf.byteLength <= MAX_AUDIO_BYTES) {
            const mime = resp.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg";
            const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("webm") ? "webm" : mime.includes("wav") ? "wav" : "mp3";
            const { error } = await sb.storage.from("video-audio").upload(`${videoId}.${ext}`, new Blob([buf], { type: mime }), { contentType: mime, upsert: true });
            audioStaged = !error;
          }
        }
      } catch (e) {
        console.warn("[ingest-from-library] audio staging failed:", e instanceof Error ? e.message : e);
      }
    }

    if (body.autostart === false) {
      return json({ remote_id: videoId, remote_url: `/admin/videos/${videoId}/edit`, status: "pending", audio_staged: audioStaged }, 200, cors);
    }

    const pipelineResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-english-video`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`, "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    });
    if (!pipelineResp.ok) {
      const detail = await pipelineResp.text().catch(() => "");
      await sb.from("discover_videos").update({ transcription_status: "failed", transcription_error: `Failed to start processing: ${detail.slice(0, 300)}` }).eq("id", videoId);
      return json({ error: "pipeline_start_failed", remote_id: videoId, detail: detail.slice(0, 300) }, 502, cors);
    }

    return json({ remote_id: videoId, remote_url: `/admin/videos/${videoId}/edit`, status: "processing", audio_staged: audioStaged }, 200, cors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingest-from-library] error", msg);
    return json({ error: "server_error", detail: msg.slice(0, 400) }, 500, cors);
  }
});
