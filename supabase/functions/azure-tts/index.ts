/**
 * azure-tts — Azure Cognitive Services Text-to-Speech for Arabic.
 *
 * Converts Arabic text to MP3 audio using the Azure Speech REST API.
 * Mirrors the same interface as the previous elevenlabs-tts function so
 * all callers can switch with a single endpoint rename.
 *
 * Supported voices (pass as `voice` in request body):
 *   ar-AE-HamdanNeural   UAE Arabic — male   (default, Gulf dialect)
 *   ar-AE-FatimaNeural   UAE Arabic — female
 *   ar-SA-HamedNeural    Saudi Arabic — male
 *   ar-SA-ZariyahNeural  Saudi Arabic — female
 *   ar-KW-FahedNeural    Kuwaiti Arabic — male
 *   ar-QA-MoazNeural     Qatari Arabic — male
 *   ar-YE-MaryamNeural   Yemeni Arabic — female
 *   ar-YE-SalehNeural    Yemeni Arabic — male
 *
 * Request body:
 *   {
 *     text:   string   // Arabic text to synthesize
 *     voice?: string   // Azure voice name, default "ar-AE-HamdanNeural"
 *   }
 *
 * Response:
 *   Raw MP3 audio (Content-Type: audio/mpeg) on success.
 *
 * Required environment variables:
 *   AZURE_SPEECH_KEY      — Azure Cognitive Services speech resource key
 *
 * Provide ONE of the following to identify the endpoint:
 *   AZURE_SPEECH_ENDPOINT — Custom endpoint URL from Azure AI multi-service
 *                           resource (e.g. https://xxx.cognitiveservices.azure.com/)
 *                           Takes priority over AZURE_SPEECH_REGION when set.
 *   AZURE_SPEECH_REGION   — Azure region for standard Speech resource
 *                           (e.g. "eastus", "uaenorth")
 */

import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const AZURE_SPEECH_KEY = Deno.env.get('AZURE_SPEECH_KEY') ?? '';
const AZURE_SPEECH_ENDPOINT = Deno.env.get('AZURE_SPEECH_ENDPOINT') ?? '';
const AZURE_SPEECH_REGION = Deno.env.get('AZURE_SPEECH_REGION') ?? 'eastus';

/** Build the TTS REST endpoint URL, preferring a custom endpoint if configured */
function getTtsEndpoint(): string {
  if (AZURE_SPEECH_ENDPOINT) {
    const base = AZURE_SPEECH_ENDPOINT.replace(/\/$/, '');
    // Azure AI multi-service resources require /tts/ prefix
    return `${base}/tts/cognitiveservices/v1`;
  }
  return `https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

const DEFAULT_VOICE = 'ar-AE-HamdanNeural';

const SUPPORTED_VOICES = [
  'ar-AE-HamdanNeural',
  'ar-AE-FatimaNeural',
  'ar-SA-HamedNeural',
  'ar-SA-ZariyahNeural',
  'ar-KW-FahedNeural',
  'ar-KW-NouraNeural',
  'ar-QA-MoazNeural',
  'ar-QA-AmalNeural',
  'ar-BH-AliNeural',
  'ar-BH-LailaNeural',
  'ar-OM-AbdullahNeural',
  'ar-OM-AyshaNeural',
  'ar-EG-ShakirNeural',
  'ar-EG-SalmaNeural',
  'ar-YE-MaryamNeural',
  'ar-YE-SalehNeural',
];

/** Build SSML for the Azure TTS request */
function buildSsml(text: string, voice: string): string {
  // Derive xml:lang from the voice name (e.g. "ar-AE-HamdanNeural" → "ar-AE")
  const lang = voice.split('-').slice(0, 2).join('-');
  // Escape XML special characters in the text
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return `<speak version='1.0' xml:lang='${lang}'><voice xml:lang='${lang}' name='${voice}'>${escaped}</voice></speak>`;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Generous free-tier daily cap: blocks anonymous abuse of paid TTS while
  // leaving normal (even heavy) logged-in playback unaffected. Paid/admin bypass.
  const cap = await enforceDailyCap(req, 'azure-tts', 400, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    let body: { text: string; voice?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { text, voice = DEFAULT_VOICE } = body;

    if (!text || typeof text !== 'string' || text.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!AZURE_SPEECH_KEY) {
      console.error('AZURE_SPEECH_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'Azure Speech key not configured (AZURE_SPEECH_KEY)' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const ssml = buildSsml(text.trim(), voice);

    const endpoint = getTtsEndpoint();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    let azureRes: Response;
    try {
      azureRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'ArabicBuddy/1.0',
        },
        body: ssml,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        return new Response(
          JSON.stringify({ error: 'Azure TTS request timed out' }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (!azureRes.ok) {
      const errText = await azureRes.text();
      console.error(`Azure TTS error ${azureRes.status}:`, errText);
      return new Response(
        JSON.stringify({ error: `Azure TTS API error ${azureRes.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const audioBuffer = await azureRes.arrayBuffer();
    console.log(`Azure TTS synthesized ${audioBuffer.byteLength} bytes for voice ${voice}`);

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('azure-tts error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
