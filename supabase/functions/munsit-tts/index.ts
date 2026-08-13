/**
 * munsit-tts — Munsit Arabic Text-to-Speech (https://api.munsit.com/api/v1).
 *
 * Used as the Gulf-dialect voice for vocabulary playback. Mirrors the
 * azure-tts contract: POST { text, voice? } → audio/wav bytes.
 *
 * Voice & model resolution:
 *   - On cold start, fetches GET /voices once and caches the first voice
 *     whose `dialect` array contains "najdi" / "emirati" / "khaleeji" / "gulf".
 *   - Falls back to the first available neural voice if no Gulf match found.
 *   - Optional secret overrides:
 *       MUNSIT_GULF_VOICE_ID   — explicit voice_id (skips auto-pick)
 *       MUNSIT_TTS_MODEL_ID    — explicit model_id (default: "munsit-tts-v1")
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const MUNSIT_BASE = "https://api.munsit.com/api/v1";

const GULF_DIALECTS = new Set(["najdi", "emirati", "khaleeji", "gulf", "saudi", "kuwaiti", "qatari", "bahraini"]);

let cachedVoiceId: string | null = null;
let cachedModelId: string | null = null;
let voicePickPromise: Promise<{ voiceId: string; modelId: string } | null> | null = null;

async function pickModelId(apiKey: string): Promise<string | null> {
  // Override wins
  const override = Deno.env.get("MUNSIT_TTS_MODEL_ID")?.trim();
  if (override) return override;
  try {
    const resp = await fetch(`${MUNSIT_BASE}/models`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const models = await resp.json() as Array<{ model_id: string; model_name?: string }>;
    if (!Array.isArray(models) || models.length === 0) return null;
    // Prefer the "mini" / fast model for short-word playback latency,
    // then fall back to any preview model, then anything.
    const mini = models.find((m) => /mini/i.test(m.model_id));
    const v1 = models.find((m) => /v1/i.test(m.model_id));
    const picked = mini ?? v1 ?? models[0];
    console.log(`munsit-tts: selected model "${picked.model_name ?? picked.model_id}"`);
    return picked.model_id;
  } catch (err) {
    console.warn("munsit-tts: failed to fetch /models:", err);
    return null;
  }
}

async function pickGulfVoice(apiKey: string): Promise<{ voiceId: string; modelId: string } | null> {
  const overrideVoice = Deno.env.get("MUNSIT_GULF_VOICE_ID")?.trim();

  const [voicesResp, modelId] = await Promise.all([
    fetch(`${MUNSIT_BASE}/voices`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    }).catch((e) => { console.warn("munsit-tts /voices fetch:", e); return null; }),
    pickModelId(apiKey),
  ]);

  if (!modelId) {
    console.warn("munsit-tts: no model_id resolvable");
    return null;
  }

  if (overrideVoice) return { voiceId: overrideVoice, modelId };

  if (!voicesResp || !voicesResp.ok) {
    console.warn(`munsit-tts /voices ${voicesResp?.status ?? "no-response"}`);
    return null;
  }
  const voices = await voicesResp.json() as Array<{
    voice_id: string;
    name?: string;
    dialect?: string[];
    languages?: string[];
    type?: string | null;
  }>;
  if (!Array.isArray(voices) || voices.length === 0) return null;

  const gulfVoice = voices.find((v) =>
    Array.isArray(v.dialect) &&
    v.dialect.some((d) => GULF_DIALECTS.has(d.toLowerCase()))
  );
  const picked = gulfVoice ?? voices.find((v) => v.type === "neural") ?? voices[0];
  if (!picked?.voice_id) return null;

  console.log(`munsit-tts: selected voice "${picked.name ?? picked.voice_id}" (${picked.dialect?.join(",") ?? "?"})`);
  return { voiceId: picked.voice_id, modelId };
}

async function getVoice(apiKey: string): Promise<{ voiceId: string; modelId: string } | null> {
  if (cachedVoiceId && cachedModelId) {
    return { voiceId: cachedVoiceId, modelId: cachedModelId };
  }
  if (!voicePickPromise) {
    voicePickPromise = pickGulfVoice(apiKey).then((res) => {
      if (res) {
        cachedVoiceId = res.voiceId;
        cachedModelId = res.modelId;
      }
      return res;
    }).finally(() => {
      // Allow re-pick after a transient failure
      if (!cachedVoiceId) voicePickPromise = null;
    });
  }
  return voicePickPromise;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Generous free-tier daily cap: blocks anonymous abuse of paid TTS while
  // leaving normal (even heavy) logged-in playback unaffected. Paid/admin bypass.
  const cap = await enforceDailyCap(req, "munsit-tts", 400, corsHeaders);
  if (cap.limited) return cap.response;

  const apiKey = Deno.env.get("MUNSIT_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "MUNSIT_API_KEY not configured" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: { text?: string; voice?: string; stability?: number; speed?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return new Response(
      JSON.stringify({ error: "text is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let resolved: { voiceId: string; modelId: string } | null;
  if (body.voice) {
    const modelId = Deno.env.get("MUNSIT_TTS_MODEL_ID")?.trim()
      || (await pickModelId(apiKey));
    resolved = modelId ? { voiceId: body.voice, modelId } : null;
  } else {
    resolved = await getVoice(apiKey);
  }

  if (!resolved) {
    return new Response(
      JSON.stringify({ error: "Could not resolve a Munsit voice" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { voiceId, modelId } = resolved;

  try {
    const resp = await fetch(`${MUNSIT_BASE}/text-to-speech/${encodeURIComponent(modelId)}`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        voice_id: voiceId,
        text,
        stability: typeof body.stability === "number" ? body.stability : 0.6,
        speed: typeof body.speed === "number" ? body.speed : 1.0,
        streaming: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error(`Munsit TTS ${resp.status}:`, t.slice(0, 300));
      // Graceful degradation: signal client to fall back to another TTS provider
      // (rate limit, quota, or upstream server errors)
      const fallback = resp.status === 429 || resp.status === 402 || resp.status >= 500;
      return new Response(
        JSON.stringify({
          error: fallback ? "SERVICE_UNAVAILABLE" : `Munsit TTS ${resp.status}`,
          detail: t.slice(0, 500),
          fallback,
          status: resp.status,
        }),
        {
          status: fallback ? 200 : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const audio = await resp.arrayBuffer();
    return new Response(audio, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/wav",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("munsit-tts error:", msg);
    return new Response(
      JSON.stringify({ error: "SERVICE_FAILED", detail: msg, fallback: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
