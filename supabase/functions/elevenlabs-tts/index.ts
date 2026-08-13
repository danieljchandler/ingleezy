import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { EMPTY_USAGE } from "../_shared/llmUsageCore.ts";
import { logLlmUsage } from "../_shared/llmUsageLogger.ts";

// Voices this function is allowed to synthesize. Callers can only pick from
// this set; anything else falls back to the default, so an attacker can't
// select arbitrary/premium ElevenLabs voices by injecting a voiceId.
//
// Native Egyptian Arabic voices (same set _shared/listenTts.ts curates for
// Listen episodes). Previously this function only allowed a generic English
// premade voice, so the conversation simulator spoke Egyptian through an
// English voice.
const EGYPTIAN_VOICE_IDS = [
  "6aXW46RTUz6Y2lkBGQ1a", // Farida — Lively and Radiant (female, ar-EG)
  "rMheqEfwsIJckq2yCdb5", // Ahmed Yahia (male, ar-EG)
  "ckGEQg6YnSVooU5uDRsF", // Tarek — Pleasant and Professional (male, ar-EG)
];
const GENERIC_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George (English premade)
const DEFAULT_VOICE_ID = EGYPTIAN_VOICE_IDS[1]; // Ahmed Yahia — native ar-EG
const ALLOWED_VOICE_IDS = new Set<string>([...EGYPTIAN_VOICE_IDS, GENERIC_VOICE_ID]);
// A/B knob shared with listenTts: ELEVENLABS_TTS_MODEL (e.g. eleven_v3).
const MODEL_ID = Deno.env.get("ELEVENLABS_TTS_MODEL")?.trim() || "eleven_multilingual_v2";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // This function runs with verify_jwt=false; there is NO gateway auth. The
  // daily cap below is the only access control — it requires a signed-in user
  // and blocks anonymous abuse of the paid TTS API. Paid/admin users bypass.
  const cap = await enforceDailyCap(req, "elevenlabs-tts", 300, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { text, voiceId: requestedVoiceId } = await req.json();
    const voiceId = ALLOWED_VOICE_IDS.has(requestedVoiceId) ? requestedVoiceId : DEFAULT_VOICE_ID;

    if (!text) {
      return new Response(
        JSON.stringify({ error: "Text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      console.error("ELEVENLABS_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Generating TTS for: "${text}" with voice: ${voiceId}`);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.3,        // Lower for natural Arabic prosody/tonal variation
            similarity_boost: 0.8, // High for voice clarity
            style: 0.7,           // Higher for expressive Arabic inflection
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ElevenLabs API error [${response.status}]:`, errorText);
      return new Response(
        JSON.stringify({ error: `ElevenLabs API error: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    console.log(`Generated audio: ${audioBuffer.byteLength} bytes`);

    // ElevenLabs bills per character; cost telemetry records the unit count so
    // the admin cost view covers the speech legs, not just the LLM ones.
    logLlmUsage({
      functionName: "elevenlabs-tts",
      model: MODEL_ID,
      provider: "elevenlabs",
      usage: EMPTY_USAGE,
      units: typeof text === "string" ? text.length : null,
      unitKind: "characters",
    });

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
      },
    });
  } catch (error) {
    console.error("TTS error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "TTS generation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
