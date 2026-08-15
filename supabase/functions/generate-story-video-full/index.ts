// generate-story-video-full — After admin approves the preview slideshow,
// generate the full multi-scene slideshow: N scene images + N Arabic
// narration clips, saved as ordered segments on story_video_segments.
// Each segment: { image_url, audio_url, narration_arabic, arabic_beat,
// duration_seconds, prompt, index }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { estimateSeconds, planEnglishProvider, synthesizeLine } from "../_shared/listenTts.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const IMAGE_MODEL = "google/gemini-3.1-flash-image";
const BUCKET = "listen-audio";
const MIN_SCENES = 3;
const MAX_SCENES = 6;

type Story = {
  id: string;
  title: string;
  title_arabic: string | null;
  body_english: string | null;
  dialect: string | null;
  story_video_approved: boolean | null;
};

type Plan = {
  style_anchor: string;
  characters: { id: string; appearance: string }[];
  scenes: {
    index: number;
    arabic_beat: string;
    visual_prompt: string;
    characters_in_scene: string[];
  }[];
};

function hasLatin(text: string): boolean { return /[A-Za-z]/.test(text); }
function normalizeArabicText(text: string): string { return text.replace(/\s+/g, " ").trim(); }
function firstWords(text: string, maxWords: number): string {
  return normalizeArabicText(text).split(/\s+/).slice(0, maxWords).join(" ");
}
/**
 * Inverted from the Arabic era, and kept rather than dropped: the story beats
 * must be quoted from the ENGLISH text now, and this check is what catches a
 * story whose columns were filled the wrong way round — the failure the whole
 * flip exists to prevent.
 */
function validateEnglishOnly(label: string, text: string): string {
  const normalized = normalizeArabicText(text);
  if (!normalized) throw new Error(`${label} is empty`);
  if (!hasLatin(normalized)) throw new Error(`${label} contains no English text`);
  return normalized;
}

async function planFilm(story: Story): Promise<Plan> {
  // The story text. Post-flip this is the ENGLISH: `body_fusha` held the
  // Arabic source and is null on everything the flipped importer writes, so
  // reading it here handed the storyboard director an empty story and left it
  // planning scenes from the title alone.
  const fullEnglish = story.body_english ?? "";

  const system = `You are a storyboard director planning a slideshow that adapts a short story. You will read the ENTIRE story and design a coherent visual world where every scene image feels like part of one storybook.

Return STRICT JSON:
{
  "style_anchor": "one paragraph (<=60 words) describing shared illustration style: lighting, color palette, era, painterly feel, and a setting that suits the story itself",
  "characters": [
    { "id": "short_slug", "appearance": "concrete visual description: age, build, face, hair, exact clothing, distinguishing features" }
  ],
  "scenes": [
    {
      "index": 0,
      "arabic_beat": "the sentence(s) from the story this scene depicts, quoted verbatim from the story text",
      "visual_prompt": "single storybook illustration description of WHAT IS DEPICTED in the frame that matches the beat. Do NOT include style/setting/character descriptions (prepended automatically). No text in image, no captions, no subtitles.",
      "characters_in_scene": ["character_id_slug"]
    }
  ]
}

Hard rules:
- Between ${MIN_SCENES} and ${MAX_SCENES} scenes, ordered start-to-end, covering the WHOLE story with no gaps.
- Every scene MUST correspond to real content from the provided story. Do not invent events.
- Characters listed once with consistent appearance; reused across scenes by id.
- arabic_beat MUST be quoted verbatim from the provided English story. (The field keeps its old name; its contents are the story's own words, which are English.)
- No text/captions/subtitles/signs in the generated image.
- Output valid JSON only, no prose, no markdown fences.`;

  const user = `STORY TITLE: ${story.title}

STORY (authoritative — every scene must match this):
${fullEnglish}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_IDS.GEMINI_FAST,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`scene planning failed: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  const content: string = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Plan;
  if (!parsed.style_anchor || !Array.isArray(parsed.scenes) || parsed.scenes.length < MIN_SCENES) {
    throw new Error("planner produced invalid plan");
  }
  return {
    style_anchor: parsed.style_anchor,
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    scenes: parsed.scenes.slice(0, MAX_SCENES).map((scene, idx) => ({
      ...scene,
      index: idx,
      arabic_beat: validateEnglishOnly(`scene ${idx + 1} arabic_beat`, scene.arabic_beat),
      visual_prompt: scene.visual_prompt || "A precise storybook depiction of the story beat.",
      characters_in_scene: Array.isArray(scene.characters_in_scene) ? scene.characters_in_scene : [],
    })),
  };
}

function buildScenePrompt(plan: Plan, sceneIdx: number): string {
  const scene = plan.scenes[sceneIdx];
  const cast = (scene.characters_in_scene ?? [])
    .map((id) => plan.characters.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => `- ${c!.id}: ${c!.appearance}`)
    .join("\n");
  return [
    `ILLUSTRATION STYLE (constant across the whole story): ${plan.style_anchor}`,
    cast ? `CHARACTERS IN THIS SCENE (keep appearance identical across scenes):\n${cast}` : "",
    `SCENE ${sceneIdx + 1} of ${plan.scenes.length}. Storybook illustration depicting this exact story beat.`,
    `STORY BEAT (do not include the text in the image, only depict it visually): ${scene.arabic_beat}`,
    `SCENE DESCRIPTION: ${scene.visual_prompt}`,
    `CONSTRAINTS: No text of any language in the image. No captions, no subtitles, no signs, no logos, no watermarks, no Latin letters, no Arabic letters. Purely visual.`,
  ].filter(Boolean).join("\n\n");
}

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

async function synthesizeSceneNarration(
  admin: ReturnType<typeof createClient>,
  story: Story,
  sceneIndex: number,
  arabicBeat: string,
): Promise<{ audio_url: string; narration_arabic: string; duration_seconds: number }> {
  const narration = validateEnglishOnly(`scene ${sceneIndex + 1} narration`, firstWords(arabicBeat, 40));
  const providerPlan = planEnglishProvider();
  const bytes = await synthesizeLine(narration, "narrator", sceneIndex, providerPlan);
  const path = `authentic-stories/${story.id}/full-${sceneIndex}-narration-${Date.now()}.${providerPlan.ext}`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: providerPlan.contentType,
    upsert: true,
  });
  if (up.error) throw up.error;
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return {
    audio_url: pub.publicUrl,
    narration_arabic: narration,
    duration_seconds: estimateSeconds(bytes.byteLength, providerPlan),
  };
}

async function uploadImage(
  admin: ReturnType<typeof createClient>,
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

async function runFull(admin: ReturnType<typeof createClient>, story: Story, plan: Plan) {
  try {
    const segments: {
      image_url: string;
      audio_url: string;
      narration_arabic: string;
      duration_seconds: number;
      prompt: string;
      index: number;
      arabic_beat: string;
      // legacy field kept for backwards compat in UI selectors
      url?: string;
    }[] = [];

    for (let i = 0; i < plan.scenes.length; i++) {
      try {
        const prompt = buildScenePrompt(plan, i);
        const narration = await synthesizeSceneNarration(admin, story, i, plan.scenes[i].arabic_beat);
        const bytes = await generateSceneImage(prompt);
        const imageUrl = await uploadImage(admin, story.id, bytes, `full-${i}-scene`);
        segments.push({
          image_url: imageUrl,
          url: imageUrl,
          audio_url: narration.audio_url,
          narration_arabic: narration.narration_arabic,
          duration_seconds: narration.duration_seconds,
          prompt,
          index: i,
          arabic_beat: plan.scenes[i].arabic_beat,
        });

        await admin
          .from("authentic_stories")
          .update({ story_video_segments: segments })
          .eq("id", story.id);
      } catch (segErr) {
        console.error(`scene ${i} failed`, segErr);
      }
    }

    if (segments.length === 0) throw new Error("no scenes generated");

    await admin
      .from("authentic_stories")
      .update({ story_video_full_status: "ready", story_video_full_error: null })
      .eq("id", story.id);
    console.log("story slideshow ready", story.id, segments.length, "scenes");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("generate-story-video-full bg failed", story.id, message);
    await admin
      .from("authentic_stories")
      .update({ story_video_full_status: "failed", story_video_full_error: message.slice(0, 500) })
      .eq("id", story.id);
  }
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
      .select("id, title, title_arabic, body_english, dialect, story_video_approved")
      .eq("id", story_id)
      .single();
    if (storyErr || !story) {
      return new Response(JSON.stringify({ error: "story_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!(story as Story).story_video_approved) {
      return new Response(JSON.stringify({ error: "preview_not_approved" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plan = await planFilm(story as Story);
    console.log("planned slideshow", story_id, "scenes:", plan.scenes.length, "chars:", plan.characters.length);

    await admin
      .from("authentic_stories")
      .update({
        story_video_full_status: "generating",
        story_video_full_error: null,
        story_video_segments: [],
      })
      .eq("id", story_id);

    // @ts-ignore EdgeRuntime provided by Supabase edge runtime
    EdgeRuntime.waitUntil(runFull(admin, story as Story, plan));

    return new Response(JSON.stringify({ status: "generating", scenes: plan.scenes.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-story-video-full error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
