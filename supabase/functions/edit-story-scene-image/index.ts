// edit-story-scene-image — Admin-only. Replace one scene image in a story's
// story_video_segments array, either by regenerating with an (optionally edited)
// prompt, or by uploading a custom image (base64 data URL).
//
// Body: { story_id, scene_index, prompt?, image_data_url? }
//   - If image_data_url is provided, it is uploaded as-is.
//   - Otherwise the prompt (or existing segment.prompt) is sent to the image model.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { dataUrlToBytes, generateImage, missingAiKeyError } from "../_shared/aiGateway.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IMAGE_MODEL = "google/gemini-3.1-flash-image";
const BUCKET = "listen-audio";

type Segment = {
  image_url?: string;
  url?: string;
  audio_url?: string;
  narration_text?: string;
  story_beat?: string;
  duration_seconds?: number;
  prompt?: string;
  index?: number;
};

async function generateSceneImage(prompt: string): Promise<Uint8Array> {
  const dataUrl = await generateImage(IMAGE_MODEL, prompt, { signal: AbortSignal.timeout(90_000) });
  return dataUrlToBytes(dataUrl);
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string; ext: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("image_data_url must be a base64 data URL");
  const contentType = m[1] || "image/png";
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = contentType.includes("jpeg") ? "jpg" : contentType.split("/")[1] || "png";
  return { bytes, contentType, ext };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const missingKey = missingAiKeyError(IMAGE_MODEL);
    if (missingKey) throw new Error(missingKey);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin/content_reviewer check
    const { data: canManage } = await admin.rpc("can_manage_content");
    if (!canManage) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { story_id, scene_index, prompt, image_data_url } = await req.json();
    if (!story_id || typeof scene_index !== "number") {
      return new Response(JSON.stringify({ error: "missing story_id or scene_index" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: story, error: storyErr } = await admin
      .from("authentic_stories")
      .select("id, story_video_segments")
      .eq("id", story_id)
      .single();
    if (storyErr || !story) throw new Error("story not found");

    const segments = (story.story_video_segments ?? []) as Segment[];
    if (!Array.isArray(segments) || scene_index < 0 || scene_index >= segments.length) {
      throw new Error("scene_index out of range");
    }

    let bytes: Uint8Array;
    let contentType = "image/png";
    let ext = "png";
    let usedPrompt = segments[scene_index].prompt ?? "";

    if (image_data_url) {
      const decoded = decodeDataUrl(image_data_url);
      bytes = decoded.bytes;
      contentType = decoded.contentType;
      ext = decoded.ext;
    } else {
      usedPrompt = (prompt && prompt.trim()) || segments[scene_index].prompt || "";
      if (!usedPrompt) throw new Error("no prompt available to regenerate");
      bytes = await generateSceneImage(usedPrompt);
    }

    const path = `authentic-stories/${story_id}/scene-${scene_index}-edit-${Date.now()}.${ext}`;
    const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (up.error) throw up.error;
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

    const updated = [...segments];
    updated[scene_index] = {
      ...updated[scene_index],
      image_url: pub.publicUrl,
      url: pub.publicUrl,
      prompt: usedPrompt || updated[scene_index].prompt,
    };

    const { error: updateErr } = await admin
      .from("authentic_stories")
      .update({ story_video_segments: updated })
      .eq("id", story_id);
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ ok: true, image_url: pub.publicUrl, scene_index }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("edit-story-scene-image error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
