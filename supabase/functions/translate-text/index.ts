// translate-text — paste Arabic, get a nuanced English breakdown
// Sentence-by-sentence with literal + natural + optional cultural note,
// plus a detected_dialect string. Used by /translate page.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { LITERAL_GLOSS_RULE, literalSchema } from "../_shared/literalGloss.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const MAX_CHARS = 4000;

interface SentenceOut {
  arabic: string;
  literal: string;
  natural: string;
  note?: string;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cap = await enforceDailyCap(req, "translate-text", 30, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const body = await req.json().catch(() => ({}));
    const rawText = typeof body?.text === "string" ? body.text.trim() : "";
    const requestedDialect = typeof body?.dialect === "string" ? body.dialect : "auto";

    if (!rawText) {
      return new Response(JSON.stringify({ error: "missing_text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (rawText.length > MAX_CHARS) {
      return new Response(
        JSON.stringify({ error: "text_too_long", limit: MAX_CHARS }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Pick a dialect for the brain. When the user says "auto" we still need a
    // value for the dialect rulebook prompt — default to Gulf and let the
    // model report the *detected* dialect in its output.
    const dialectForPrompt: Dialect =
      requestedDialect === "Egyptian" || requestedDialect === "Yemeni" || requestedDialect === "Gulf"
        ? (requestedDialect as Dialect)
        : "Gulf";

    const systemExtra = `You are a careful Arabic-to-English translator and dialect detector.
You will receive a passage of colloquial Arabic. Your job:
1. Detect the dialect: one of "Gulf", "Egyptian", "Yemeni" (default to "Gulf" if unclear).
2. Split the passage into natural sentences (preserve the user's original Arabic exactly — same words, same order, no MSA rewriting).
3. For each sentence return:
   - arabic: the Arabic sentence, verbatim from the input
   - literal: a close word-for-word English gloss (may sound stiff)
   - natural: a fluent, idiomatic English translation
   - note: ONLY when the sentence contains an idiom, cultural reference, register shift, sarcasm, or a word whose surface meaning would mislead an English speaker. Otherwise omit the field.
${LITERAL_GLOSS_RULE}
Do not add sentences that aren't in the input. Do not translate to MSA. Return ONLY the structured tool call.`;

    const userPrompt =
      requestedDialect === "auto"
        ? `Translate the following Arabic. Detect the dialect.\n\n"""\n${rawText}\n"""`
        : `Translate the following ${requestedDialect} Arabic.\n\n"""\n${rawText}\n"""`;

    let brain;
    try {
      brain = await askBrain<{
        detected_dialect: string;
        sentences: SentenceOut[];
      }>({
        purpose: "translate-text",
        dialect: dialectForPrompt,
        strategy: "solo",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 4096,
        temperature: 0.2,
        skipRepair: true, // we preserve the user's original Arabic verbatim
        tool: {
          name: "emit_translation",
          description: "Return the per-sentence nuanced translation.",
          parameters: {
            type: "object",
            properties: {
              detected_dialect: {
                type: "string",
                enum: ["Gulf", "Egyptian", "Yemeni"],
                description: "The dialect of the source passage.",
              },
              sentences: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    arabic: { type: "string", description: "Sentence verbatim from input." },
                    literal: literalSchema("sentence"),
                    natural: { type: "string", description: "Fluent English translation." },
                    note: {
                      type: "string",
                      description:
                        "Optional cultural / idiom / register note. Omit when not needed.",
                    },
                  },
                  required: ["arabic", "literal", "natural"],
                },
              },
            },
            required: ["detected_dialect", "sentences"],
          },
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = (e as { status?: number })?.status ?? 502;
      console.error("[translate-text] brain error", status, msg);
      return new Response(
        JSON.stringify({ error: "ai_failed", detail: msg.slice(0, 400) }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const out = brain.output ?? { detected_dialect: dialectForPrompt, sentences: [] };
    const detected = ["Gulf", "Egyptian", "Yemeni"].includes(out.detected_dialect)
      ? out.detected_dialect
      : dialectForPrompt;

    const sentences: SentenceOut[] = Array.isArray(out.sentences)
      ? out.sentences
          .filter((s) => s && typeof s.arabic === "string" && s.arabic.trim().length > 0)
          .map((s) => ({
            arabic: String(s.arabic).trim(),
            literal: String(s.literal ?? "").trim(),
            natural: String(s.natural ?? "").trim(),
            ...(typeof s.note === "string" && s.note.trim() ? { note: s.note.trim() } : {}),
          }))
      : [];

    if (sentences.length === 0) {
      return new Response(
        JSON.stringify({ error: "empty_translation", raw: brain.raw?.slice(0, 400) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        detected_dialect: detected,
        sentences,
        used_dialect: requestedDialect,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[translate-text] error", msg);
    return new Response(JSON.stringify({ error: "server_error", detail: msg.slice(0, 400) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
