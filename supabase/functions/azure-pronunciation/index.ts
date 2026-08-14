/**
 * azure-pronunciation — Azure Cognitive Services Pronunciation Assessment.
 *
 * Evaluates learner pronunciation against a reference text and returns
 * granular scores at the overall, word, and phoneme levels. Flipped: the
 * primary target is ENGLISH (en-US default, en-GB supported); the Arabic
 * locales stay supported for the shadowing surfaces that still echo native
 * Arabic clips.
 *
 * Supported locales (pass as `locale` in request body):
 *   en-US  English, United States (default)
 *   en-GB  English, United Kingdom
 *   ar-SA  Saudi Arabia
 *   ar-QA  Qatar
 *   ar-KW  Kuwait
 *   ar-BH  Bahrain
 *   ar-AE  UAE
 *   ar-OM  Oman
 *   ar-EG  Egypt (MSA / Egyptian dialect)
 *
 * Request body:
 *   {
 *     audioBase64:  string   // Base64-encoded audio blob (WebM/Opus from MediaRecorder)
 *     referenceText: string  // Text the learner was asked to pronounce
 *     locale?:      string   // BCP-47 locale, default "en-US"
 *     dialect?:     string   // Learner's L1 bucket for recorded errors when
 *                            // assessing English (Gulf/Egyptian/Yemeni)
 *     audioMimeType?: string // MIME type, default "audio/webm"
 *   }
 *
 * Response:
 *   {
 *     overall:        number   // PronScore 0–100
 *     accuracy:       number   // Phoneme-level accuracy 0–100
 *     fluency:        number   // Speaking rate / pauses 0–100
 *     completeness:   number   // Words spoken vs reference 0–100
 *     words: [{
 *       word:       string
 *       accuracy:   number
 *       errorType:  "None" | "Omission" | "Insertion" | "Mispronunciation"
 *       phonemes: [{ phoneme: string, accuracy: number }]
 *     }]
 *     recognizedText: string   // What Azure actually heard
 *     locale:         string
 *   }
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
import { recordLearnerErrors, resolveLearnerErrors } from "../_shared/learnerErrors.ts";
import { contributeLearnerAudio } from "../_shared/learnerAudioContribution.ts";


const AZURE_SPEECH_KEY = Deno.env.get('AZURE_SPEECH_KEY') ?? '';
const AZURE_SPEECH_ENDPOINT = Deno.env.get('AZURE_SPEECH_ENDPOINT') ?? '';
const AZURE_SPEECH_REGION = Deno.env.get('AZURE_SPEECH_REGION') ?? 'eastus';

/** Build the STT REST endpoint URL, preferring a custom endpoint if configured */
function getSttEndpoint(): string {
  if (AZURE_SPEECH_ENDPOINT) {
    const base = AZURE_SPEECH_ENDPOINT.replace(/\/$/, '');
    // Azure AI multi-service resources require /stt/ prefix
    return `${base}/stt/speech/recognition/conversation/cognitiveservices/v1`;
  }
  return `https://${AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;
}

// ar-YE included: localeToDialect below already maps it to 'Yemeni' — its
// omission here meant Yemeni learners got a hard 400 from a branch that was
// clearly meant to work.
const SUPPORTED_LOCALES = ['en-US', 'en-GB', 'ar-SA', 'ar-QA', 'ar-KW', 'ar-BH', 'ar-AE', 'ar-OM', 'ar-EG', 'ar-YE'];

/**
 * Map an Azure locale back to the app's dialect module, so recorded errors land
 * in the same bucket the learner's deck uses. Every Gulf country locale folds to
 * "Gulf"; ar-EG is the only non-Gulf locale Azure assessment supports here.
 */
function localeToDialect(locale: string, bodyDialect?: string): string {
  // An English locale says nothing about the learner's L1 bucket; the client
  // sends it alongside. Arabic locales keep the original mapping.
  if (locale.startsWith('en')) {
    return ['Gulf', 'Egyptian', 'Yemeni'].includes(bodyDialect ?? '') ? (bodyDialect as string) : 'Gulf';
  }
  if (locale === 'ar-EG') return 'Egyptian';
  if (locale === 'ar-YE') return 'Yemeni';
  return 'Gulf';
}

/** Azure Pronunciation Assessment config sent as base64 header */
interface PronunciationConfig {
  ReferenceText: string;
  GradingSystem: 'HundredMark';
  Granularity: 'Phoneme';
  EnableMiscue: boolean;
  /** IPA gives learner-readable symbols; the default (SAPI) renders as raw engine phoneme strings. */
  PhonemeAlphabet: 'IPA';
  /** Return the top-N phoneme candidates so the UI can show what was said instead of the target. */
  NBestPhonemeCount: number;
  EnableProsodyAssessment: boolean;
}

interface PhonemeResult {
  phoneme: string;
  accuracy: number;
  /** Top alternative phonemes Azure heard (IPA) — shows the learner what they said instead. */
  nbest?: Array<{ phoneme: string; accuracy: number }>;
}

/** Raw phoneme/syllable entry as Azure returns it. Azure nests scores under
 *  PronunciationAssessment in some responses and inlines them in others. */
interface AzurePhoneme {
  Phoneme?: string;
  Syllable?: string;
  AccuracyScore?: number;
  PronunciationAssessment?: {
    AccuracyScore?: number;
    NBestPhonemes?: Array<{ Phoneme?: string; Score?: number; AccuracyScore?: number }>;
  };
}

interface WordResult {
  word: string;
  accuracy: number;
  errorType: 'None' | 'Omission' | 'Insertion' | 'Mispronunciation';
  phonemes: PhonemeResult[];
}

interface PronunciationResult {
  overall: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  /** Prosody (stress/intonation/rhythm) — present when Azure returns it. */
  prosody?: number;
  words: WordResult[];
  recognizedText: string;
  locale: string;
}

/** Parse Azure NBest[0] into a clean PronunciationResult.
 *  Azure sometimes nests scores under PronunciationAssessment, other times
 *  puts them directly on the object — handle both. */
// deno-lint-ignore no-explicit-any
function parseAzureResponse(nbest: any, locale: string): PronunciationResult {
  const pa = nbest.PronunciationAssessment ?? {};

  const words: WordResult[] = (nbest.Words ?? []).map(
    // deno-lint-ignore no-explicit-any
    (w: any): WordResult => {
      const wpa = w.PronunciationAssessment ?? {};
      return {
        word: w.Word ?? '',
        accuracy: wpa.AccuracyScore ?? w.AccuracyScore ?? 0,
        errorType: wpa.ErrorType ?? w.ErrorType ?? 'None',
        phonemes: (w.Phonemes ?? w.Syllables ?? []).map(
          (p: AzurePhoneme): PhonemeResult => {
            const nbestRaw = p.PronunciationAssessment?.NBestPhonemes;
            return {
              phoneme: p.Phoneme ?? p.Syllable ?? '',
              accuracy: p.PronunciationAssessment?.AccuracyScore ?? p.AccuracyScore ?? 0,
              ...(Array.isArray(nbestRaw) && nbestRaw.length > 0
                ? {
                    nbest: nbestRaw.map((n) => ({
                      phoneme: n.Phoneme ?? '',
                      accuracy: n.Score ?? n.AccuracyScore ?? 0,
                    })),
                  }
                : {}),
            };
          }
        ),
      };
    }
  );

  // Scores can live under PronunciationAssessment or directly on nbest
  const overall = pa.PronScore ?? nbest.PronScore ?? pa.AccuracyScore ?? nbest.AccuracyScore ?? 0;
  const accuracy = pa.AccuracyScore ?? nbest.AccuracyScore ?? 0;
  const fluency = pa.FluencyScore ?? nbest.FluencyScore ?? 0;
  const completeness = pa.CompletenessScore ?? nbest.CompletenessScore ?? 0;
  const prosody = pa.ProsodyScore ?? nbest.ProsodyScore;

  return {
    overall: overall,
    accuracy,
    fluency,
    completeness,
    ...(typeof prosody === 'number' ? { prosody } : {}),
    words,
    recognizedText: nbest.Lexical ?? nbest.Display ?? '',
    locale,
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, 'azure-pronunciation', 60, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    // Parse request body — return 400 for malformed JSON
    let body: { audioBase64: string; referenceText: string; locale?: string; audioMimeType?: string; dialect?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const {
      audioBase64,
      referenceText,
      locale = 'en-US',
      audioMimeType = 'audio/webm',
    } = body;

    if (!audioBase64 || !referenceText) {
      return new Response(
        JSON.stringify({ error: 'audioBase64 and referenceText are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!SUPPORTED_LOCALES.includes(locale)) {
      return new Response(
        JSON.stringify({ error: `Unsupported locale '${locale}'. Supported: ${SUPPORTED_LOCALES.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!AZURE_SPEECH_KEY) {
      return new Response(
        JSON.stringify({ error: 'Azure Speech key not configured (AZURE_SPEECH_KEY)' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the Pronunciation-Assessment header (base64-encoded JSON)
    const pronunciationConfig: PronunciationConfig = {
      ReferenceText: referenceText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      EnableMiscue: true,
      PhonemeAlphabet: 'IPA',
      NBestPhonemeCount: 3,
      EnableProsodyAssessment: true,
    };
    // btoa() only handles Latin1 — encode the JSON as UTF-8 bytes, then base64
    const configUtf8 = new TextEncoder().encode(JSON.stringify(pronunciationConfig));
    let binaryStr = '';
    for (let i = 0; i < configUtf8.length; i++) {
      binaryStr += String.fromCharCode(configUtf8[i]);
    }
    const pronunciationHeader = btoa(binaryStr);

    // Decode audio from base64 — return 400 for invalid base64
    let audioBytes: Uint8Array;
    try {
      audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    } catch {
      return new Response(
        JSON.stringify({ error: 'audioBase64 is not valid base64' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine Content-Type — strip any existing codecs param and re-add
    const baseMime = audioMimeType.split(';')[0].trim();
    const contentType = baseMime === 'audio/webm'
      ? 'audio/webm; codecs=opus'
      : baseMime === 'audio/ogg'
      ? 'audio/ogg; codecs=opus'
      : baseMime; // wav, mp4, etc. passed as-is

    // Azure Speech REST endpoint
    const endpoint = getSttEndpoint();
    const params = new URLSearchParams({ language: locale, format: 'detailed' });

    // Bound the Azure call with a 30s timeout — pronunciation assessment with
    // Phoneme granularity can take 15–25s for longer phrases on cold endpoints.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let azureRes: Response;
    try {
      azureRes = await fetch(`${endpoint}?${params}`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
          'Content-Type': contentType,
          'Pronunciation-Assessment': pronunciationHeader,
          'Accept': 'application/json',
        },
        body: new Blob([new Uint8Array(audioBytes.buffer as ArrayBuffer)]),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        return new Response(
          JSON.stringify({ error: 'Azure Speech request timed out' }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (!azureRes.ok) {
      const errText = await azureRes.text();
      console.error(`Azure Speech error ${azureRes.status}:`, errText);
      return new Response(
        JSON.stringify({ error: `Azure API error ${azureRes.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await azureRes.json();
    console.log('Azure raw response:', JSON.stringify(data).slice(0, 2000));
    if (data.RecognitionStatus === 'NoMatch' || data.RecognitionStatus === 'InitialSilenceTimeout') {
      return new Response(
        JSON.stringify({
          error: 'No speech detected',
          recognitionStatus: data.RecognitionStatus,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const nbest = data.NBest?.[0];
    if (!nbest) {
      return new Response(
        JSON.stringify({ error: 'No assessment results returned', raw: data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = parseAzureResponse(nbest, locale);
    console.log(`Pronunciation assessment [${locale}] overall=${result.overall} accuracy=${result.accuracy} words=${result.words.length}`);

    // Persist the words Azure flagged so they can be targeted later. Azure's
    // per-word errorType is the most precise signal the app produces about
    // production, and until now it was rendered once and dropped.
    // Fire-and-forget: never let bookkeeping delay or fail the learner's result.
    const mispronounced = result.words.filter(
      (w) => w.errorType && w.errorType !== 'None' && w.word,
    );
    if (mispronounced.length > 0) {
      void recordLearnerErrors(
        cap.userId,
        mispronounced.map((w) => ({
          source: 'pronunciation' as const,
          dialect: localeToDialect(locale, body.dialect),
          targetArabic: w.word,
          errorKind: String(w.errorType).toLowerCase(),
          detail: { locale, accuracy: w.accuracy, overall: result.overall },
        })),
      );
    } else {
      // Clean run — clear the words we'd previously flagged. Resolve per word,
      // not on referenceText: errors are recorded against individual words, so
      // resolving the whole utterance would never match anything.
      const spoken = result.words.map((w) => w.word).filter(Boolean);
      void resolveLearnerErrors(cap.userId, spoken, localeToDialect(locale, body.dialect));
    }

    // Opt-in audio contribution (profiles.contribute_audio, off by default):
    // the clip, the target text, what Azure heard, and the score — the
    // flywheel's W5 lane. Fire-and-forget; the module checks consent itself.
    contributeLearnerAudio({
      userId: cap.userId,
      dialect: localeToDialect(locale, body.dialect),
      audioBytes,
      mimeType: baseMime,
      referenceText,
      recognizedText: typeof nbest.Display === 'string' ? nbest.Display : null,
      score: typeof result.overall === 'number' ? result.overall : null,
      sourceFunction: 'azure-pronunciation',
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('azure-pronunciation error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
