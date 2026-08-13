/**
 * practice-sentence-coach
 *
 * Given a short voice recording of a learner trying to use a target Arabic
 * vocabulary word in a sentence, transcribes the utterance via Munsit ASR and
 * returns dialect-aware coaching feedback: a naturalness rewrite, 2-3
 * alternative phrasings, encouraging pronunciation tips, and a lenient
 * correctness verdict. Intentionally forgiving of non-native pronunciation —
 * focuses on intelligibility and dialect authenticity, not accent perfection.
 *
 * Body: {
 *   audioBase64: string,
 *   mimeType?: string,
 *   targetArabic: string,   // the vocabulary word / phrase the learner is practising
 *   targetEnglish?: string,
 *   dialect?: string,        // "Gulf" | "Egyptian" | "Yemeni"
 * }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { munsitModel, munsitFallbackModel } from "../_shared/asrConfig.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { recordLearnerErrors, resolveLearnerErrors } from "../_shared/learnerErrors.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getDialectLabel, getDialectTransliterationRules, type Dialect } from "../_shared/dialectHelpers.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";

const MUNSIT_BASE = "https://api.munsit.com/api/v1";

interface CoachFeedback {
  used_target_word: boolean;
  understandable: boolean;
  verdict: string;
  natural_rewrite: string;
  natural_rewrite_english: string;
  alternatives: { arabic: string; english: string }[];
  tips: string[];
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
      description: "True if a native speaker would understand the intent, even with mistakes.",
    },
    verdict: {
      type: "string",
      description: "One short encouraging sentence summarising how it went.",
    },
    natural_rewrite: {
      type: "string",
      description: "The learner's sentence rewritten naturally in the target dialect. Arabic script.",
    },
    natural_rewrite_english: {
      type: "string",
      description: "English gloss of the natural rewrite.",
    },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          arabic: { type: "string" },
          english: { type: "string" },
        },
        required: ["arabic", "english"],
      },
      description: "2 alternative native phrasings.",
    },
    tips: {
      type: "array",
      items: { type: "string" },
      description: "1-2 short encouraging usage/pronunciation tips.",
    },
  },
  required: [
    "used_target_word",
    "understandable",
    "verdict",
    "natural_rewrite",
    "natural_rewrite_english",
    "alternatives",
    "tips",
  ],
} as const;

function toDialect(d?: string): Dialect {
  if (d === "Egyptian") return "Egyptian";
  if (d === "Yemeni") return "Yemeni";
  return "Gulf";
}

async function munsitCall(audioBase64: string, mimeType: string, apiKey: string, model: string): Promise<string> {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || "audio/webm" });
  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "m4a" : "webm";
  const fd = new FormData();
  fd.append("file", new File([blob], `utterance.${ext}`, { type: blob.type }));
  fd.append("model", model);

  const resp = await fetch(`${MUNSIT_BASE}/audio/transcribe`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: fd,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Munsit ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  // Munsit nests transcript under data.data.transcription (see model registry notes)
  return (data?.data?.transcription ?? data?.transcription ?? "").toString().trim();
}

/**
 * Transcribe with the primary Munsit model, retrying once on the other model
 * when the first answer is empty. The bare `munsit` model went degraded
 * upstream (a few characters back for any payload), so the default is now
 * `munsit-en-ar` — the retry covers the reverse happening later.
 */
async function munsitTranscribe(audioBase64: string, mimeType: string, apiKey: string): Promise<string> {
  const primary = munsitModel();
  const first = await munsitCall(audioBase64, mimeType, apiKey, primary);
  if (first.trim()) return first;
  const fallback = munsitFallbackModel(primary);
  console.warn(`munsit: empty transcription from ${primary} — retrying with ${fallback}`);
  return await munsitCall(audioBase64, mimeType, apiKey, fallback);
}

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, "practice-sentence-coach", 40, cors);
  if (cap.limited) return cap.response;

  try {
    const { audioBase64, mimeType, targetArabic, targetEnglish, dialect } = await req.json();
    if (!audioBase64 || !targetArabic) {
      return new Response(
        JSON.stringify({ error: "audioBase64 and targetArabic are required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const munsitKey = Deno.env.get("MUNSIT_API_KEY");
    if (!munsitKey) throw new Error("MUNSIT_API_KEY not configured");

    // Step 1: Transcribe
    const transcript = await munsitTranscribe(audioBase64, mimeType || "audio/webm", munsitKey);
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

    // Step 2: Coach through the shared Brain so the dialect rewrite/alternatives
    // inherit dialect identity + MSA-leak scan/repair.
    const resolvedDialect = toDialect(dialect);
    const dLabel = getDialectLabel(resolvedDialect);

    const systemPromptExtra =
      `You are a warm, encouraging Arabic tutor specializing in ${dLabel}. ` +
      `You coach non-native learners who are just starting to speak. Be GENEROUS with pronunciation — ` +
      `if the transcript is close to what the learner likely meant, treat it as understood. Focus on ` +
      `natural dialect phrasing, grammar, and word usage, NOT on accent perfection. ` +
      `Never demand Modern Standard Arabic — stay in ${dLabel} throughout.\n\n` +
      `${getDialectTransliterationRules(resolvedDialect)}`;

    const userPrompt =
      `The learner is practising the word "${targetArabic}"` +
      (targetEnglish ? ` (meaning: "${targetEnglish}")` : "") +
      ` by trying to say a sentence with it.\n\n` +
      `ASR transcript of what they said (may contain small ASR errors — be lenient): "${transcript}"\n\n` +
      `Assess:\n` +
      `1. Did they use the target word (or a close variant)?\n` +
      `2. Is the sentence understandable and natural in ${dLabel}?\n` +
      `3. Provide a corrected/more natural rewrite in ${dLabel} — keep it close to their intent.\n` +
      `4. Give 2 alternative ways a native ${dLabel} speaker might say the same idea.\n` +
      `5. Give 1-2 short, encouraging pronunciation/usage tips (not accent nitpicks).\n` +
      `Reply via the return_feedback tool ONLY.`;

    let brain;
    try {
      brain = await askBrain<CoachFeedback>({
        purpose: "practice_sentence_coach",
        dialect: resolvedDialect,
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
        arabicTextPath: (p) => {
          const out = p as CoachFeedback;
          const alts = (out?.alternatives ?? []).map((a) => a?.arabic ?? "").join("\n");
          return `${out?.natural_rewrite ?? ""}\n${alts}`;
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

    // The coach's verdict is the app's clearest signal about production: it
    // knows whether the learner actually used the target word and whether a
    // native speaker would have understood them. Persist the misses so the
    // target comes back around in generated content; clear them on a clean run.
    const feedback = brain.output as CoachFeedback;
    if (feedback?.used_target_word === false || feedback?.understandable === false) {
      void recordLearnerErrors(cap.userId, [{
        source: "sentence_coach",
        dialect: resolvedDialect,
        targetArabic,
        producedArabic: transcript ?? null,
        errorKind: feedback?.used_target_word === false ? "wrong_word" : "other",
        detail: {
          natural_rewrite: feedback?.natural_rewrite ?? null,
          tips: feedback?.tips ?? [],
        },
      }]);
    } else {
      void resolveLearnerErrors(cap.userId, targetArabic, resolvedDialect);
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
