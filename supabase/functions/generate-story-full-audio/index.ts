// generate-story-full-audio — Full TTS generation for all lines of an authentic story.
// Uses the shared listenTts.ts helpers. Narrates the ENGLISH line: post-flip
// the story's text is English and the Arabic is the scaffold beside it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { planEnglishProvider, synthesizeLine } from "../_shared/listenTts.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let parsedStoryId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { story_id } = await req.json();
    parsedStoryId = story_id;
    if (!story_id) {
      return new Response(JSON.stringify({ error: "missing story_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as generating
    await admin
      .from("authentic_stories")
      .update({ video_status: "generating" })
      .eq("id", story_id);

    // Fetch story
    const { data: story, error: storyErr } = await admin
      .from("authentic_stories")
      .select("id, dialect")
      .eq("id", story_id)
      .single();

    if (storyErr || !story) {
      return new Response(JSON.stringify({ error: "story_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all lines
    const { data: lines, error: linesErr } = await admin
      .from("authentic_story_lines")
      .select("*")
      .eq("story_id", story_id)
      .order("line_index", { ascending: true });

    if (linesErr || !lines || lines.length === 0) {
      await admin.from("authentic_stories").update({ video_status: "failed" }).eq("id", story_id);
      return new Response(JSON.stringify({ error: "no_lines_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // English narration — see generate-story-preview-audio for why.
    const plan = planEnglishProvider();

    const lineDurations: number[] = [];
    let totalDuration = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const textToSpeak = line.english;

      if (!textToSpeak) {
        lineDurations.push(0);
        continue;
      }

      try {
        // Neighboring lines condition ElevenLabs prosody so narration flows
        // across line boundaries (no-op for other providers).
        const prevLine = lines[i - 1];
        const nextLine = lines[i + 1];
        const bytes = await synthesizeLine(textToSpeak, "narrator", i, plan, {
          previousText: prevLine?.english ?? undefined,
          nextText: nextLine?.english ?? undefined,
        });
        const path = `authentic-stories/${story_id}/line-${i}.${plan.ext}`;

        const { error: upErr } = await admin.storage
          .from("listen-audio")
          .upload(path, bytes, { contentType: plan.contentType, upsert: true });

        if (upErr) {
          console.warn(`Upload failed for line ${i}:`, upErr.message);
          lineDurations.push(0);
          continue;
        }

        const { data: pub } = admin.storage.from("listen-audio").getPublicUrl(path);

        // Estimate duration from byte size (rough: WAV = sample_rate * 2 bytes/sec, MP3 ≈ 16kbps)
        const estimatedDuration = plan.ext === "wav"
          ? bytes.byteLength / (24000 * 2)  // 24kHz mono 16-bit
          : bytes.byteLength / 2000;          // ~16kbps MP3
        lineDurations.push(Math.round(estimatedDuration * 10) / 10);
        totalDuration += estimatedDuration;

        // Update line with audio URL and duration
        await admin
          .from("authentic_story_lines")
          .update({
            audio_url: pub.publicUrl,
            duration_seconds: Math.round(estimatedDuration * 10) / 10,
          })
          .eq("id", line.id);
      } catch (lineErr: unknown) {
        console.warn(`TTS failed for line ${i}:`, lineErr instanceof Error ? lineErr.message : lineErr);
        lineDurations.push(0);
      }
    }

    // Get first line audio as the main audio URL
    const { data: firstLine } = await admin
      .from("authentic_story_lines")
      .select("audio_url")
      .eq("story_id", story_id)
      .eq("line_index", 0)
      .maybeSingle();

    // Update story with completion status
    await admin
      .from("authentic_stories")
      .update({
        video_status: "ready",
        audio_url: firstLine?.audio_url || null,
        line_durations: lineDurations,
        duration_seconds: Math.round(totalDuration * 10) / 10,
      })
      .eq("id", story_id);

    return new Response(JSON.stringify({
      success: true,
      lines_generated: lines.length,
      total_duration: Math.round(totalDuration * 10) / 10,
      provider: plan.provider,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("generate-story-full-audio fatal:", e);
    // Mark as failed
    try {
      if (parsedStoryId) {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
        await admin.from("authentic_stories").update({ video_status: "failed" }).eq("id", parsedStoryId);
      }
    } catch (cleanupErr) { console.warn("Failed to mark story as failed:", cleanupErr); }

    return new Response(JSON.stringify({ error: "internal", detail: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
