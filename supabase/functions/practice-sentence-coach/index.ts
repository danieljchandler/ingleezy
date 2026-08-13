/**
 * practice-sentence-coach — the first English-target caller of the Brain.
 *
 * Given a short voice recording of a learner trying to use a target ENGLISH
 * word in a sentence, transcribes the utterance via Deepgram (nova-3, en) and
 * returns L1-aware coaching: a natural English rewrite with a dialect-Arabic
 * gloss, alternative phrasings, and encouraging tips written in the learner's
 * own dialect. Intentionally forgiving of non-native pronunciation — focuses
 * on intelligibility and natural phrasing, not accent perfection.
 *
 * What makes it L1-aware rather than generic ESL coaching:
 *  - the Brain runs with target: 'english', so the system prompt carries the
 *    interference rulebook (article drops, copula omission, calques …);
 *  - the transfer-error detector runs on the transcript first, and its hits
 *    are handed to the model so known Arabic-shaped phrases are always
 *    addressed by name;
 *  - misses are persisted to learner_errors with the interference categories
 *    in `detail`, feeding the mistake flywheel and /mistakes.
 *
 * Body: {
 *   audioBase64: string,
 *   mimeType?: string,
 *   targetEnglish: string,  // the vocabulary word / phrase being practised
 *   targetArabic?: string,  // its gloss in the learner's dialect (scaffold)
 *   dialect?: string,       // the learner's L1: "Gulf" | "Egyptian" | "Yemeni"
 *   cefr?: string,          // conditions feedback complexity (A1–C1)
 * }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { recordLearnerErrors, resolveLearnerErrors } from "../_shared/learnerErrors.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { getTransferPatterns } from "../_shared/englishHelpers.ts";
import { detectTransferErrors } from "../_shared/transferErrorDetector.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

interface CoachFeedback {
  used_target_word: boolean;
  understandable: boolean;
  /** One short encouraging sentence, in the learner's dialect Arabic. */
  verdict_ar: string;
  natural_rewrite: string;
  natural_rewrite_arabic: string;
  alternatives: { english: string; arabic: string }[];
  /** 1-2 short tips in the learner's dialect Arabic. */
  tips_ar: string[];
  /** Interference patterns the coach observed, named for the learner. */
  interference_notes: { category: string; note_ar: string }[];
}

const FEEDBACK_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    used_target_word: {
      type: "boolean",
      description: "True if the learner used the target word or a close variant.",
    },
    understandable: {
      type: "boolean",
      description: "True if a native English speaker would understand the intent, even with mistakes.",
    },
    verdict_ar: {
      type: "string",
      description: "One short encouraging sentence in the learner's dialect Arabic.",
    },
    natural_rewrite: {
      type: "string",
      description: "The learner's sentence rewritten as natural spoken English, close to their intent.",
    },
    natural_rewrite_arabic: {
      type: "string",
      description: "Gloss of the natural rewrite in the learner's dialect Arabic.",
    },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          english: { type: "string" },
          arabic: { type: "string" },
        },
        required: ["english", "arabic"],
      },
      description: "2 alternative natural English phrasings, each with a dialect-Arabic gloss.",
    },
    tips_ar: {
      type: "array",
      items: { type: "string" },
      description: "1-2 short encouraging tips, written in the learner's dialect Arabic.",
    },
    interference_notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "article | copula | phonology | preposition | calque | word_order | morphology | spelling | register",
          },
          note_ar: { type: "string", description: "The pattern explained briefly in the learner's dialect Arabic." },
        },
        required: ["category", "note_ar"],
      },
      description: "Arabic-interference patterns present in the attempt. Empty when clean.",
    },
  },
  required: [
    "used_target_word",
    "understandable",
    "verdict_ar",
    "natural_rewrite",
    "natural_rewrite_arabic",
    "alternatives",
    "tips_ar",
    "interference_notes",
  ],
} as const;

function toDialect(d?: string): Dialect {
  if (d === "Egyptian") return "Egyptian";
  if (d === "Yemeni") return "Yemeni";
  return "Gulf";
}

/** Transcribe a short English utterance. Nova-3 handles accented English well;
 *  keyterm boosting nudges it toward the word being practised. */
async function deepgramTranscribe(
  audioBase64: string,
  mimeType: string,
  apiKey: string,
  keyterm?: string,
): Promise<string> {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const params = new URLSearchParams({
    model: "nova-3",
    language: "en",
    punctuate: "true",
    smart_format: "true",
  });
  if (keyterm?.trim()) params.append("keyterm", `${keyterm.trim()}:2`);

  const resp = await fetch(`${DEEPGRAM_URL}?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": mimeType || "audio/webm",
    },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Deepgram ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const transcript: string =
    data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  return transcript.toString().trim();
}

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, "practice-sentence-coach", 40, cors);
  if (cap.limited) return cap.response;

  try {
    const { audioBase64, mimeType, targetEnglish, targetArabic, dialect, cefr } = await req.json();
    if (!audioBase64 || !targetEnglish) {
      return new Response(
        JSON.stringify({ error: "audioBase64 and targetEnglish are required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!deepgramKey) throw new Error("DEEPGRAM_API_KEY not configured");

    // Step 1: Transcribe the English attempt.
    const transcript = await deepgramTranscribe(
      audioBase64,
      mimeType || "audio/webm",
      deepgramKey,
      targetEnglish,
    );
    if (!transcript) {
      return new Response(
        JSON.stringify({
          transcript: "",
          empty: true,
          message: "We couldn't hear anything — try recording again, a bit closer to the mic.",
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const resolvedDialect = toDialect(dialect);
    const dLabel = getDialectLabel(resolvedDialect);

    // Step 2: Deterministic transfer scan — known Arabic-shaped phrases in
    // the transcript. Handed to the model so they are addressed by name, and
    // persisted with any miss for the flywheel.
    const detected = detectTransferErrors(transcript, getTransferPatterns(resolvedDialect));
    const detectedBlock = detected.errors.length
      ? `\n\nKnown Arabic-transfer phrases detected in the attempt (address each one, kindly):\n` +
        detected.errors
          .map((e) => `- "${e.match}" (${e.category}${e.suggestion ? ` → "${e.suggestion}"` : ""})`)
          .join("\n")
      : "";

    // Step 3: Coach through the Brain's English-target mode. The system
    // prompt carries the English identity + interference rulebook; this
    // extra block sets the coaching persona and the language of feedback.
    const systemPromptExtra =
      `You are a warm, encouraging English coach for a native ${dLabel} speaker. ` +
      `Be GENEROUS with pronunciation — ASR of accented English is imperfect; if the transcript is ` +
      `close to what the learner likely meant, treat it as understood. Focus on natural spoken English ` +
      `phrasing and the Arabic-interference patterns above, NOT accent perfection. ` +
      `All feedback fields ending in _ar MUST be written in ${dLabel} (never Fusha, never English).`;

    const userPrompt =
      `The learner is practising the English word "${targetEnglish}"` +
      (targetArabic ? ` (${dLabel}: "${targetArabic}")` : "") +
      ` by trying to say a sentence with it.\n\n` +
      `ASR transcript of what they said (may contain small ASR errors — be lenient): "${transcript}"` +
      detectedBlock +
      `\n\nAssess:\n` +
      `1. Did they use the target word (or a close variant)?\n` +
      `2. Would a native English speaker understand the sentence?\n` +
      `3. Rewrite it as natural spoken English, close to their intent, with a ${dLabel} gloss.\n` +
      `4. Give 2 alternative natural phrasings of the same idea, each with a ${dLabel} gloss.\n` +
      `5. Name any Arabic-interference patterns present (include the detected ones above; add others you see).\n` +
      `6. Give 1-2 short encouraging tips in ${dLabel}.\n` +
      `Reply via the return_feedback tool ONLY.`;

    let brain;
    try {
      brain = await askBrain<CoachFeedback>({
        purpose: "practice_sentence_coach",
        dialect: resolvedDialect,
        target: "english",
        cefr: typeof cefr === "string" ? cefr : undefined,
        strategy: "solo",
        models: [MODEL_IDS.GEMINI_FLASH],
        userPrompt,
        systemPromptExtra,
        maxTokens: 1024,
        temperature: 0.4,
        tool: {
          name: "return_feedback",
          description: "Return sentence-practice coaching feedback",
          parameters: FEEDBACK_TOOL_PARAMETERS as unknown as Record<string, unknown>,
        },
      });
    } catch (e) {
      if (e instanceof BrainHttpError) {
        if (e.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limited — please try again in a moment." }),
            { status: 429, headers: { ...cors, "Content-Type": "application/json" } },
          );
        }
        if (e.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI credits exhausted — please add funds." }),
            { status: 402, headers: { ...cors, "Content-Type": "application/json" } },
          );
        }
      }
      throw e;
    }

    // The coach's verdict is the app's clearest signal about production.
    // Persist misses so the target comes back around in generated content —
    // tagged with the interference categories, which is what makes the
    // flywheel L1-aware. (learner_errors columns keep their Arabic-era names
    // until the data-model rename; target_arabic carries the English target.)
    const feedback = brain.output as CoachFeedback;
    const interference = [
      ...new Set([
        ...detected.errors.map((e) => e.category),
        ...(feedback?.interference_notes ?? []).map((n) => n?.category).filter(Boolean),
      ]),
    ];
    if (feedback?.used_target_word === false || feedback?.understandable === false) {
      void recordLearnerErrors(cap.userId, [{
        source: "sentence_coach",
        dialect: resolvedDialect,
        targetArabic: targetEnglish,
        producedArabic: transcript ?? null,
        errorKind: feedback?.used_target_word === false ? "wrong_word" : "other",
        detail: {
          natural_rewrite: feedback?.natural_rewrite ?? null,
          tips: feedback?.tips_ar ?? [],
          interference,
          detector_rule_ids: detected.errors.map((e) => e.rule_id).filter(Boolean),
        },
      }]);
    } else {
      void resolveLearnerErrors(cap.userId, targetEnglish, resolvedDialect);
    }

    return new Response(
      JSON.stringify({ transcript, ...brain.output }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("practice-sentence-coach error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
