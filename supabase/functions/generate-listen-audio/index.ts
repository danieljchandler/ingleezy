import { getCorsHeaders } from "../_shared/cors.ts";
// generate-listen-audio — Full-episode audio synthesis.
// Munsit (WAV) for Gulf, Azure (MP3) for others. Concatenates clips into
// one playable file and caches per-line URLs for tap-to-hear.
//
// IMPORTANT: TTS for a 10–15 line episode can take longer than the edge
// function request budget. We therefore:
//   1) return 202 immediately and run synthesis as a background task
//      (EdgeRuntime.waitUntil), and
//   2) make the loop resumable/idempotent — already-synthesised lines are
//      skipped, and updated_at is heart-beated per line so a watchdog can
//      detect a truly stuck job.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  planProvider,
  synthesizeLine,
  concatForPlan,
  estimateSeconds,
} from "../_shared/listenTts.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

async function runJob(episodeId: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const { data: episode, error: epErr } = await admin
      .from("listen_episodes")
      .select("*")
      .eq("id", episodeId)
      .maybeSingle();
    if (epErr || !episode) throw new Error(`episode_not_found: ${epErr?.message ?? ""}`);

    await admin
      .from("listen_episodes")
      .update({ audio_status: "pending", updated_at: new Date().toISOString() })
      .eq("id", episodeId);

    const plan = await planProvider(episode.dialect);
    console.log(`generate-listen-audio: episode=${episodeId} provider=${plan.provider}`);

    // Resume support: which lines do we already have?
    const { data: existingRows } = await admin
      .from("listen_line_audio")
      .select("line_index")
      .eq("episode_id", episodeId);
    const existing = new Set<number>((existingRows ?? []).map((r: any) => r.line_index));

    const script = (episode.script as any[]) ?? [];
    const parts: Uint8Array[] = [];
    const lineDurations: number[] = [];
    let runningSeconds = 0;

    for (let i = 0; i < script.length; i++) {
      const line = script[i];
      if (!line?.arabic) {
        lineDurations.push(0);
        continue;
      }

      const linePath = `episodes/${episodeId}/line-${i}.${plan.ext}`;
      let bytes: Uint8Array | null = null;

      if (existing.has(i)) {
        // Reuse already-uploaded line audio
        const { data: dl } = await admin.storage.from("listen-audio").download(linePath);
        if (dl) bytes = new Uint8Array(await dl.arrayBuffer());
      }

      if (!bytes) {
        bytes = await synthesizeLine(line.arabic, line.speaker_role ?? "", i, plan);
        await admin.storage.from("listen-audio").upload(linePath, bytes, {
          contentType: plan.contentType, upsert: true,
        });
        const { data: pub } = admin.storage.from("listen-audio").getPublicUrl(linePath);
        const seconds = estimateSeconds(bytes.length, plan);
        await admin.from("listen_line_audio").upsert(
          {
            episode_id: episodeId,
            line_index: i,
            speaker: line.speaker ?? null,
            audio_url: pub.publicUrl,
            duration_seconds: seconds,
          },
          { onConflict: "episode_id,line_index" },
        );
      }

      parts.push(bytes);
      const seconds = estimateSeconds(bytes.length, plan);
      lineDurations.push(seconds);
      runningSeconds += seconds;

      // Heartbeat so a watchdog can tell the job is still alive
      await admin
        .from("listen_episodes")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", episodeId);
    }

    const fullBytes = concatForPlan(parts, plan);
    const fullPath = `episodes/${episodeId}/full.${plan.ext}`;
    const { error: upErr } = await admin.storage
      .from("listen-audio")
      .upload(fullPath, fullBytes, { contentType: plan.contentType, upsert: true });
    if (upErr) throw new Error(`full upload: ${upErr.message}`);
    const { data: fullPub } = admin.storage.from("listen-audio").getPublicUrl(fullPath);

    await admin
      .from("listen_episodes")
      .update({
        full_audio_url: fullPub.publicUrl,
        line_durations: lineDurations,
        duration_seconds: runningSeconds,
        audio_status: "ready",
      })
      .eq("id", episodeId);

    console.log(`generate-listen-audio: done episode=${episodeId} lines=${script.length}`);
  } catch (e: any) {
    console.error("generate-listen-audio job failed", episodeId, e);
    try {
      await admin
        .from("listen_episodes")
        .update({ audio_status: "failed" })
        .eq("id", episodeId);
    } catch {}
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { episodeId } = await req.json();
    if (!episodeId) {
      return new Response(JSON.stringify({ error: "episodeId_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Run synthesis off the request path so we don't get killed when the
    // HTTP response budget elapses.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(runJob(episodeId));
    } else {
      // Fallback for local dev: fire-and-forget without awaiting
      runJob(episodeId);
    }

    return new Response(
      JSON.stringify({ accepted: true, episodeId }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("generate-listen-audio dispatch error", e);
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
