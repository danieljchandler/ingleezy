/**
 * writing-coach
 *
 * Written production (C3) — the fourth skill. Two actions:
 *
 *   { action: "prompt", dialect }
 *     A short incoming text message in ENGLISH for the learner to reply to —
 *     texting is where most learners actually write English, and a message
 *     that invites an answer is a cheaper starting point than a blank box.
 *     The framing and the gloss come back in the learner's dialect.
 *     Personalised with the learner's interests and weak words where a
 *     profile exists.
 *
 *   { action: "review", dialect, text, promptEnglish? }
 *     The learner's typed ENGLISH reply, corrected in English with every
 *     explanation written in their dialect — the correction is the moment
 *     the explanation has to land, so it is given in the language they
 *     think in. Returns a corrected version plus per-span corrections.
 *     Each correction is also recorded to `learner_errors` (source
 *     "writing"), so written mistakes feed the same weak-set loop as spoken
 *     ones; a clean reply resolves earlier writing errors on the same spans.
 *
 * Both directions used to point the other way — this generated a dialect
 * message and corrected the learner's Arabic, down to an `msa_leak`
 * correction kind. The kinds are now the areas an Arabic speaker actually
 * loses marks in English: articles, prepositions and tense, which Arabic
 * either lacks or builds differently.
 *
 * Text-only and solo-strategy, so it is one of the cheaper AI calls; the caps
 * are correspondingly generous but still laddered per tier.
 */
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";
import { recordLearnerErrors } from "../_shared/learnerErrors.ts";

/** Longest reply we will review. Beyond this it is an essay, not a message. */
const MAX_TEXT_CHARS = 600;

/** At least one Latin letter, or there is no English here to coach. */
const LATIN_LETTER = /[A-Za-z]/;

const KNOWN_DIALECTS = new Set(["Gulf", "Egyptian", "Yemeni"]);

interface Correction {
  original: string;
  corrected: string;
  kind: string;
  explanation: string;
}

interface WritingReview {
  understandable: boolean;
  /** One short encouraging line, in the learner's dialect. */
  verdict_arabic: string;
  /** The learner's own reply, minimally repaired. */
  corrected_english: string;
  /** What the corrected reply means, in the learner's dialect. */
  corrected_arabic: string;
  corrections: Correction[];
  /** Written in the learner's dialect. */
  tips: string[];
}

interface WritingPrompt {
  /** One line of situation framing, in the learner's dialect. */
  scenario_arabic: string;
  /** The incoming message, as a native would text it. */
  message_english: string;
  /** What it means, in the learner's dialect. */
  message_arabic: string;
}

/**
 * learner_errors.error_kind values the model may choose from.
 *
 * `article`, `preposition` and `verb_tense` replaced the Arabic era's
 * `msa_leak`: they are where Arabic speakers actually lose marks in English,
 * because Arabic has no indefinite article, maps prepositions differently,
 * and marks time with far fewer forms. The column is free text with a label
 * fallback in `src/lib/mistakes.ts`, so new kinds need no migration — but
 * they do need a label there, or the learner reads the raw slug.
 */
const CORRECTION_KINDS = [
  "spelling",
  "wrong_word",
  "word_order",
  "article",
  "preposition",
  "verb_tense",
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
  cefr?: string,
): Promise<WritingPrompt> {
  const profileBlock = await learnerPromptBlock({
    userId,
    dialect,
    target: "english",
    includeWeak: true,
    includeInterests: true,
  });

  const brain = await askBrain<WritingPrompt>({
    purpose: "writing_coach",
    dialect,
    target: "english",
    cefr,
    strategy: "solo",
    temperature: 0.9,
    maxTokens: 1024,
    systemPromptExtra: `You write ONE short, casual incoming text message in ENGLISH — the kind a friend sends on WhatsApp — for a native ${getDialectLabel(dialect)} speaker to reply to in writing.

Rules:
- 1-2 sentences, everyday topic, ends in a way that invites a written reply (a question or an easy opening).
- Written the way natives actually text: contractions, informal, no textbook English.
- If the learner profile below lists interests, pick a topic from them. If it lists weak words, work one in naturally when it fits — never force it.
- The framing and the gloss are for the learner to read, so both are in ${getDialectLabel(dialect)}, never in Modern Standard Arabic.

${profileBlock}

Return ONLY the structured fields via the provided tool.`,
    userPrompt: "Send the next message for the learner to answer.",
    // Only the dialect gloss is Arabic the model authored; the framing line is
    // scanned with it. message_english is the point of the exercise and must
    // never reach the MSA machinery.
    arabicTextPath: (p) => {
      const o = p as WritingPrompt | null;
      return [o?.message_arabic, o?.scenario_arabic].filter(Boolean).join("\n");
    },
    tool: {
      name: "emit_writing_prompt",
      description: "One short English text message for the learner to reply to.",
      parameters: {
        type: "object",
        properties: {
          scenario_arabic: {
            type: "string",
            description: `One line of situation framing in ${getDialectLabel(dialect)}, e.g. 'صاحبك يرتب لنهاية الأسبوع.'`,
          },
          message_english: { type: "string", description: "The incoming message, in natural casual English." },
          message_arabic: { type: "string", description: `What the message means, in ${getDialectLabel(dialect)}.` },
        },
        required: ["scenario_arabic", "message_english", "message_arabic"],
      },
    },
  });

  return brain.output;
}

async function reviewText(
  dialect: Dialect,
  text: string,
  promptEnglish: string,
  cefr?: string,
): Promise<WritingReview> {
  const label = getDialectLabel(dialect);
  const brain = await askBrain<WritingReview>({
    purpose: "writing_coach",
    dialect,
    target: "english",
    cefr,
    strategy: "solo",
    temperature: 0.3,
    maxTokens: 2048,
    systemPromptExtra: `You are a warm, precise English writing coach for a native ${label} speaker.
The learner has TYPED an English reply${promptEnglish ? " to this message:\n\n" + promptEnglish : ""}.

Correct their writing against how natives actually text:
- Fix real errors: spelling, wrong word choice, word order, articles, prepositions, verb tense, and grammar.
- Pay particular attention to the places Arabic pulls a writer off course: a missing or added "a/an/the", a preposition mapped straight from Arabic, and a tense that Arabic marks differently.
- Do NOT nitpick informal punctuation, missing capitals in a casual text, or a valid but less common phrasing.
- corrected_english is the learner's own reply, minimally repaired — keep their meaning, register and voice. It is NOT a fresh model answer.
- Each correction lists the exact original span, the corrected span, a kind from [${CORRECTION_KINDS.join(", ")}], and one short, encouraging explanation IN ${label.toUpperCase()} — this is the moment the explanation has to land, so give it in the language the learner thinks in.
- An empty corrections array means the reply was fine as written.
- verdict_arabic and every tip are in ${label} too. Spoken dialect, never Modern Standard Arabic.
- 1-2 tips, only if genuinely useful.

Return ONLY the structured fields via the provided tool.`,
    userPrompt: `The learner wrote:\n\n${text}`,
    // Everything Arabic here is scaffold the model wrote, so it all goes
    // through the MSA scan; corrected_english is the learner's own English and
    // must be left exactly as returned.
    arabicTextPath: (p) => {
      const o = p as WritingReview | null;
      return [o?.corrected_arabic, o?.verdict_arabic, ...(o?.tips ?? []), ...(o?.corrections ?? []).map((c) => c?.explanation)]
        .filter(Boolean)
        .join("\n");
    },
    tool: {
      name: "emit_writing_review",
      description: "Structured correction of the learner's written English reply.",
      parameters: {
        type: "object",
        properties: {
          understandable: {
            type: "boolean",
            description: "True if a native reader would understand the intent, even with mistakes.",
          },
          verdict_arabic: { type: "string", description: `One short encouraging ${label} sentence summarising how it went.` },
          corrected_english: { type: "string", description: "The learner's reply, minimally corrected, in English." },
          corrected_arabic: { type: "string", description: `What the corrected reply means, in ${label}.` },
          corrections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                original: { type: "string", description: "The exact span the learner wrote." },
                corrected: { type: "string", description: "What it should be in natural English." },
                kind: { type: "string", enum: [...CORRECTION_KINDS] },
                explanation: { type: "string", description: `One short ${label} sentence on why.` },
              },
              required: ["original", "corrected", "kind", "explanation"],
            },
          },
          tips: { type: "array", items: { type: "string" }, description: `Written in ${label}.` },
        },
        required: ["understandable", "verdict_arabic", "corrected_english", "corrected_arabic", "corrections"],
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
    const cefr = typeof body?.cefr === "string" ? body.cefr : undefined;

    if (action === "prompt") {
      const prompt = await makePrompt(cap.userId!, dialect, cefr);
      return jsonResponse({ prompt }, 200, cors);
    }

    if (action !== "review") {
      return jsonResponse({ error: "unknown_action" }, 400, cors);
    }

    const text = String(body?.text ?? "").trim();
    const promptEnglish = String(body?.promptEnglish ?? "").slice(0, 500);

    if (!text || !LATIN_LETTER.test(text)) {
      return jsonResponse(
        { error: "not_english", message: "اكتب ردك بالإنجليزي عشان نصحّحه لك." },
        400,
        cors,
      );
    }
    if (text.length > MAX_TEXT_CHARS) {
      return jsonResponse(
        { error: "too_long", message: `خلّها أقل من ${MAX_TEXT_CHARS} حرف — نصحّح رسالة وحدة في المرة.` },
        400,
        cors,
      );
    }

    const review = await reviewText(dialect, text, promptEnglish, cefr);

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
        // The shared column names still say "arabic" — they carry whatever the
        // learner is producing, which post-flip is English.
        targetArabic: c.corrected,
        producedArabic: c.original,
        errorKind: (CORRECTION_KINDS as readonly string[]).includes(c.kind) ? c.kind : "other",
        detail: { explanation: c.explanation ?? "", prompt: promptEnglish || null },
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
