// generate-story-video — Generate a slideshow-style preview: one AI-generated
// scene image + one narration clip. Cheap replacement for Veo video.
//
// Post-flip the narration is ENGLISH, for the same reason the story audio is:
// the story's text is English and hearing it read is the point. Narrating the
// dialect scaffold would be reading the learner the translation. The old
// version demanded Arabic script and threw on Latin characters, so it would
// have rejected every story in the flipped library outright.
// Reused columns:
//   story_video_url      -> preview scene IMAGE url
//   video_preview_url    -> preview narration AUDIO url
//   story_video_status   -> 'generating' | 'ready' | 'failed'

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { estimateSeconds, planEnglishProvider, synthesizeLine } from "../_shared/listenTts.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const IMAGE_MODEL = "google/gemini-3.1-flash-image";
const BUCKET = "listen-audio";

type Story = {
  id: string;
  title: string;
  title_arabic: string | null;
  body_english: string | null;
  dialect: string | null;
};

type StoryLine = {
  english: string | null;
};

function hasLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}
function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
function firstWords(text: string, maxWords: number): string {
  return normalizeText(text).split(/\s+/).slice(0, maxWords).join(" ");
}

function buildNarrationText(story: Story, lines: StoryLine[]): string {
  const fromLines = lines.map((l) => normalizeText(l.english ?? "")).find(Boolean);
  const source = fromLines || story.body_english || "";
  const firstSentence = normalizeText(source).split(/(?<=[.!?])\s+/)[0] || source;
  const narration = firstWords(firstSentence, 26);
  if (!narration) throw new Error("No English text found for preview narration");
  // Inverted from the Arabic era, and kept rather than dropped: the check is
  // what catches a story whose columns have been filled the wrong way round,
  // which is the failure this whole flip exists to prevent.
  if (!hasLatin(narration)) throw new Error("Preview narration contains no English text");
  return narration;
}

function buildImagePrompt(story: Story, storyText: string): string {
  const excerpt = normalizeText(storyText).slice(0, 800);
  // No `culturalSetting(dialect)` here any more: the dialect is the learner's
  // own, not the story's origin, so pinning a Gulf or Egyptian setting onto an
  // English text put every story in the wrong place. The scene now follows
  // whatever the text describes.
  return `Warm cinematic storybook illustration for a short story. Photorealistic painterly style, soft natural lighting, rich color palette, no text of any language, no captions, no signs, no logos, no watermarks, no letters visible in the scene. Depict the following story moment visually only:\n\n${excerpt}`;
}

/**
 * Service-role client. `SupabaseClient` rather than
 * `ReturnType<typeof createClient>`: that form instantiates the schema
 * generics from their *defaults* instead of from the call, producing a type
 * the real client is not assignable to.
 */
type Admin = SupabaseClient;

async function generateSceneImage(prompt: string): Promise<Uint8Array> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!resp.ok) throw new Error(`image gen failed: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  const b64: string | undefined = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 300)}`);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function synthesizePreviewNarration(
  admin: Admin,
  story: Story,
  lines: StoryLine[],
): Promise<{ url: string; text: string; duration: number }> {
  const text = buildNarrationText(story, lines);
  const plan = planEnglishProvider();
  const bytes = await synthesizeLine(text, "narrator", 0, plan);
  const path = `authentic-stories/${story.id}/preview-narration-${Date.now()}.${plan.ext}`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: plan.contentType,
    upsert: true,
  });
  if (up.error) throw up.error;
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, text, duration: estimateSeconds(bytes.byteLength, plan) };
}

async function uploadImage(
  admin: Admin,
  storyId: string,
  bytes: Uint8Array,
  label: string,
): Promise<string> {
  const path = `authentic-stories/${storyId}/${label}-${Date.now()}.png`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (up.error) throw up.error;
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) throw new Error("Missing LOVABLE_API_KEY");

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

    const { data: story, error: storyErr } = await admin
      .from("authentic_stories")
      .select("id, title, title_arabic, body_english, dialect")
      .eq("id", story_id)
      .single();
    if (storyErr || !story) {
      return new Response(JSON.stringify({ error: "story_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin
      .from("authentic_stories")
      .update({ story_video_status: "generating", story_video_error: null, story_video_approved: false })
      .eq("id", story_id);

    const { data: lines } = await admin
      .from("authentic_story_lines")
      .select("english")
      .eq("story_id", story_id)
      .order("line_index", { ascending: true })
      .limit(3);

    // Build narration text first (needed for image prompt), then run TTS + image gen in parallel.
    const narrationText = buildNarrationText(story as Story, (lines ?? []) as StoryLine[]);
    const prompt = buildImagePrompt(story as Story, narrationText);

    const [narration, imgBytes] = await Promise.all([
      synthesizePreviewNarration(admin, story as Story, (lines ?? []) as StoryLine[]),
      generateSceneImage(prompt),
    ]);
    const imageUrl = await uploadImage(admin, story_id, imgBytes, "preview-scene");

    // Preserve 'ready' video_status if full audio was already generated —
    // otherwise regenerating a preview scene would hide the Publish button.
    const { data: currentRow } = await admin
      .from("authentic_stories")
      .select("video_status")
      .eq("id", story_id)
      .single();
    const preserveReady = currentRow?.video_status === "ready";

    await admin
      .from("authentic_stories")
      .update({
        story_video_url: imageUrl,
        video_preview_url: narration.url,
        line_durations: [narration.duration],
        story_video_status: "ready",
        ...(preserveReady ? {} : { video_status: "preview_ready" }),
        story_video_error: null,
      })
      .eq("id", story_id);

    return new Response(
      JSON.stringify({
        status: "ready",
        image_url: imageUrl,
        audio_url: narration.url,
        narration_arabic: narration.text,
        duration_seconds: narration.duration,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-story-video error", message);
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body?.story_id) {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
        await admin
          .from("authentic_stories")
          .update({ story_video_status: "failed", story_video_error: message.slice(0, 500) })
          .eq("id", body.story_id);
      }
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
