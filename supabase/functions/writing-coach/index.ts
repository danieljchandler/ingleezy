/**
 * writing-coach
 *
 * Written production (C3) — the fourth skill. Two actions:
 *
 *   { action: "prompt", dialect }
 *     A short incoming text message in the target dialect for the learner to
 *     reply to — the situation dialectal Arabic is actually written in.
 *     Personalised with the learner's interests and weak words where a
 *     profile exists.
 *
 *   { action: "review", dialect, text, promptArabic? }
 *     The learner's typed Arabic reply, corrected against the same Rulebook
 *     that governs generation (askBrain injects the dialect identity block
 *     and dialect_rules). Returns a corrected version plus per-span
 *     corrections with explanations. Each correction is also recorded to
 *     `learner_errors` (source "writing"), so written mistakes feed the same
 *     weak-set loop as spoken ones; a clean reply resolves earlier writing
 *     errors on the same spans.
 *
 * Text-only and solo-strategy, so it is one of the cheaper AI calls; the caps
 * are correspondingly generous but still laddered per tier.
 */
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import {
  getDialectLabel,
  getDialectTransliterationRules,
  type Dialect,
} from "../_shared/dialectHelpers.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";
import { recordLearnerErrors } from "../_shared/learnerErrors.ts";

/** Longest reply we will review. Beyond this it is an essay, not a message. */
const MAX_TEXT_CHARS = 600;

/** At least one Arabic letter, or there is nothing to coach. */
const ARABIC_LETTER = /[ء-يٱ-ۓ]/;

const KNOWN_DIALECTS = new Set(["Gulf", "Egyptian", "Yemeni"]);

interface Correction {
  original: string;
  corrected: string;
  kind: string;
  explanation: string;
}

interface WritingReview {
  understandable: boolean;
  verdict: string;
  corrected_arabic: string;
  corrected_transliteration: string;
  corrected_english: string;
  corrections: Correction[];
  tips: string[];
}

interface WritingPrompt {
  scenario_english: string;
  message_arabic: string;
  message_transliteration: string;
  message_english: string;
}

/** learner_errors.error_kind values the model may choose from. */
const CORRECTION_KINDS = [
  "spelling",
  "wrong_word",
  "word_order",
  "msa_leak",
  "grammar",
  "other",
] as const;

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function makePrompt(
  userId: string,
  dialect: Dialect,
): Promise<WritingPrompt> {
  const profileBlock = await learnerPromptBlock({
    userId,
    dialect,
    includeWeak: true,
    includeInterests: true,
  });

  const brain = await askBrain<WritingPrompt>({
    purpose: "writing_coach",
    dialect,
    strategy: "solo",
    temperature: 0.9,
    maxTokens: 1024,
    systemPromptExtra: `You write ONE short, casual incoming text message in ${getDialectLabel(dialect)} — the kind a friend sends on WhatsApp — for a learner to reply to in writing.

Rules:
- 1-2 sentences, everyday topic, ends in a way that invites a written reply (a question or an easy opening).
- Written the way natives actually text: informal, dialectal, no tashkeel needed.
- If the learner profile below lists interests, pick a topic from them. If it lists weak words, work one in naturally when it fits — never force it.

${profileBlock}

${getDialectTransliterationRules(dialect)}

Return ONLY the structured fields via the provided tool.`,
    userPrompt: "Send the next message for the learner to answer.",
    arabicTextPath: (p) => (p as { message_arabic?: string } | null)?.message_arabic ?? "",
    tool: {
      name: "emit_writing_prompt",
      description: "One short dialectal text message for the learner to reply to.",
      parameters: {
        type: "object",
        properties: {
          scenario_english: {
            type: "string",
            description: "One line of situation framing in English, e.g. 'Your friend is planning the weekend.'",
          },
          message_arabic: { type: "string", description: "The incoming message, in the target dialect, Arabic script." },
          message_transliteration: { type: "string", description: "Latin transliteration of message_arabic." },
          message_english: { type: "string", description: "Natural English translation." },
        },
        required: ["scenario_english", "message_arabic", "message_transliteration", "message_english"],
      },
    },
  });

  return brain.output;
}

async function reviewText(
  dialect: Dialect,
  text: string,
  promptArabic: string,
): Promise<WritingReview> {
  const brain = await askBrain<WritingReview>({
    purpose: "writing_coach",
    dialect,
    strategy: "solo",
    temperature: 0.3,
    maxTokens: 2048,
    systemPromptExtra: `You are a warm, precise writing coach for learners of ${getDialectLabel(dialect)}.
The learner has TYPED an Arabic reply${promptArabic ? " to this message:\n\n" + promptArabic : ""}.

Correct their writing against how natives actually text in this dialect:
- Fix real errors: spelling, wrong word choice, word order, grammar, and words or structures that belong to Modern Standard Arabic rather than the dialect.
- Do NOT nitpick optional tashkeel, casual punctuation, or valid dialectal spelling variation.
- corrected_arabic is the learner's own reply, minimally repaired — keep their meaning, register and voice. It is NOT a fresh model answer.
- Each correction lists the exact original span, the corrected span, a kind from [${CORRECTION_KINDS.join(", ")}], and one short, encouraging English explanation.
- An empty corrections array means the reply was fine as written.
- 1-2 tips, only if genuinely useful.

${getDialectTransliterationRules(dialect)}
- Provide corrected_transliteration for corrected_arabic.

Return ONLY the structured fields via the provided tool.`,
    userPrompt: `The learner wrote:\n\n${text}`,
    arabicTextPath: (p) => (p as { corrected_arabic?: string } | null)?.corrected_arabic ?? "",
    tool: {
      name: "emit_writing_review",
      description: "Structured correction of the learner's written reply.",
      parameters: {
        type: "object",
        properties: {
          understandable: {
            type: "boolean",
            description: "True if a native reader would understand the intent, even with mistakes.",
          },
          verdict: { type: "string", description: "One short encouraging English sentence summarising how it went." },
          corrected_arabic: { type: "string", description: "The learner's reply, minimally corrected, Arabic script." },
          corrected_transliteration: { type: "string", description: "Latin transliteration of corrected_arabic." },
          corrected_english: { type: "string", description: "Natural English translation of the corrected reply." },
          corrections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                original: { type: "string", description: "The exact span the learner wrote." },
                corrected: { type: "string", description: "What it should be in this dialect." },
                kind: { type: "string", enum: [...CORRECTION_KINDS] },
                explanation: { type: "string", description: "One short English sentence on why." },
              },
              required: ["original", "corrected", "kind", "explanation"],
            },
          },
          tips: { type: "array", items: { type: "string" } },
        },
        required: ["understandable", "verdict", "corrected_arabic", "corrected_transliteration", "corrected_english", "corrections"],
      },
    },
  });

  return brain.output;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // A review is a full coaching pass and a prompt is a generation, so both
  // count against one shared ladder.
  const cap = await enforceDailyCap(req, "writing-coach", 10, cors, {
    standard: 40,
    allin: 120,
  });
  if (cap.limited) return cap.response;

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = (body?.action as string) || "review";
    const rawDialect: string = (body?.dialect as string) || "Gulf";
    const dialect = (KNOWN_DIALECTS.has(rawDialect) ? rawDialect : "Gulf") as Dialect;

    if (action === "prompt") {
      const prompt = await makePrompt(cap.userId!, dialect);
      return jsonResponse({ prompt }, 200, cors);
    }

    if (action !== "review") {
      return jsonResponse({ error: "unknown_action" }, 400, cors);
    }

    const text = String(body?.text ?? "").trim();
    const promptArabic = String(body?.promptArabic ?? "").slice(0, 500);

    if (!text || !ARABIC_LETTER.test(text)) {
      return jsonResponse(
        { error: "not_arabic", message: "Write your reply in Arabic script to get corrections." },
        400,
        cors,
      );
    }
    if (text.length > MAX_TEXT_CHARS) {
      return jsonResponse(
        { error: "too_long", message: `Keep it under ${MAX_TEXT_CHARS} characters — coach one message at a time.` },
        400,
        cors,
      );
    }

    const review = await reviewText(dialect, text, promptArabic);

    // Feed the weak-set loop. recordLearnerErrors never throws, and one
    // insert after a full model round-trip is negligible latency — awaited so
    // the write cannot be lost to an isolate shutting down early. Only real,
    // kinded corrections become error rows.
    const corrections = Array.isArray(review.corrections) ? review.corrections : [];
    const errorRows = corrections
      .filter((c) => c?.original?.trim() && c?.corrected?.trim())
      .map((c) => ({
        source: "writing" as const,
        dialect,
        targetArabic: c.corrected,
        producedArabic: c.original,
        errorKind: (CORRECTION_KINDS as readonly string[]).includes(c.kind) ? c.kind : "other",
        detail: { explanation: c.explanation ?? "", prompt: promptArabic || null },
      }));
    if (errorRows.length > 0) {
      await recordLearnerErrors(cap.userId, errorRows);
    }

    return jsonResponse({ review }, 200, cors);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("writing-coach error:", msg);
    return jsonResponse({ error: "coach_failed", detail: msg.slice(0, 400) }, 502, cors);
  }
});
