// generate-story-preview-audio — Generates TTS for first N lines only (preview)
// Uses the shared listenTts.ts helpers. Narrates the ENGLISH line: post-flip
// the story's text is English and the Arabic is the scaffold beside it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { planEnglishProvider, synthesizeLine } from "../_shared/listenTts.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PREVIEW_LINE_COUNT = 5;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
    if (!story_id) {
      return new Response(JSON.stringify({ error: "missing story_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch story
    const { data: story, error: storyErr } = await admin
      .from("authentic_stories")
      .select("id, dialect, status")
      .eq("id", story_id)
      .single();

    if (storyErr || !story) {
      return new Response(JSON.stringify({ error: "story_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch first N lines
    const { data: lines, error: linesErr } = await admin
      .from("authentic_story_lines")
      .select("*")
      .eq("story_id", story_id)
      .order("line_index", { ascending: true })
      .limit(PREVIEW_LINE_COUNT);

    if (linesErr || !lines || lines.length === 0) {
      return new Response(JSON.stringify({ error: "no_lines_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // English narration: the story IS the English now, and hearing it read is
    // the point of the audio. Narrating the dialect scaffold instead would be
    // reading the learner the translation rather than the text.
    const plan = planEnglishProvider();

    // Generate audio for preview lines
    const audioUrls: string[] = [];
    let totalDuration = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const textToSpeak = line.english;

      if (!textToSpeak) continue;

      const bytes = await synthesizeLine(textToSpeak, "narrator", i, plan);
      const path = `authentic-stories/${story_id}/preview-line-${i}.${plan.ext}`;

      const { error: upErr } = await admin.storage
        .from("listen-audio")
        .upload(path, bytes, { contentType: plan.contentType, upsert: true });

      if (upErr) {
        console.warn(`Upload failed for preview line ${i}:`, upErr.message);
        continue;
      }

      const { data: pub } = admin.storage.from("listen-audio").getPublicUrl(path);
      audioUrls.push(pub.publicUrl);

      // Update line with audio URL
      await admin
        .from("authentic_story_lines")
        .update({ audio_url: pub.publicUrl })
        .eq("id", line.id);
    }

    // Update story with preview status
    const previewUrl = audioUrls[0] || null;
    await admin
      .from("authentic_stories")
      .update({
        video_status: "preview_generated",
        video_preview_url: previewUrl,
      })
      .eq("id", story_id);

    return new Response(JSON.stringify({
      success: true,
      preview_lines: audioUrls.length,
      preview_url: previewUrl,
      provider: plan.provider,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("generate-story-preview-audio fatal:", e);
    return new Response(JSON.stringify({ error: "internal", detail: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
