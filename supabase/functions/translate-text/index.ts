// translate-text — paste ENGLISH, get a nuanced dialect-Arabic breakdown.
// The learner meets English in the wild (an email, a post, a message) and
// pastes it here: sentence-by-sentence with a natural dialect translation, a
// word-for-word Arabic gloss in English order, and a note in their own Arabic
// when an idiom or register shift would mislead. Used by /translate page.
//
// The Brain call stays ARABIC-target: the generated text is the scaffold, so
// the full dialect machinery (identity, rulebook, MSA scan) guards it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const MAX_CHARS = 4000;

interface SentenceOut {
  english: string;
  arabic: string;
  literal: string;
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

    // The dialect picks which Arabic the glosses are written in. "auto" from
    // an old client falls back to Gulf; the page resolves it to the learner's
    // active dialect before calling.
    const dialectForPrompt: Dialect =
      requestedDialect === "Egyptian" || requestedDialect === "Yemeni" || requestedDialect === "Gulf"
        ? (requestedDialect as Dialect)
        : "Gulf";
    const dialectLabel = getDialectLabel(dialectForPrompt);

    const systemExtra = `You are a careful English-to-${dialectLabel} translator for an Arabic-speaking English learner.
You will receive a passage of English. Your job:
1. Split the passage into natural sentences (preserve the user's original English exactly — same words, same order, no rewriting).
2. For each sentence return:
   - english: the English sentence, verbatim from the input
   - arabic: a fluent, natural ${dialectLabel} translation (authentic spoken dialect, NEVER Modern Standard Arabic / فصحى)
   - literal: a close word-for-word ${dialectLabel} gloss that preserves the ENGLISH word order and structure. It may sound stiff in Arabic — that is expected; its purpose is to show the learner how the English sentence is built. Never merge it with the natural translation.
   - note: ONLY when the sentence contains an idiom, phrasal verb, cultural reference, register shift, or sarcasm whose surface meaning would mislead an Arabic speaker — written in ${dialectLabel}. Otherwise omit the field.
Do not add sentences that aren't in the input. Return ONLY the structured tool call.`;

    const userPrompt = `Translate the following English for a ${dialectLabel} speaker.\n\n"""\n${rawText}\n"""`;

    let brain;
    try {
      brain = await askBrain<{
        sentences: SentenceOut[];
      }>({
        purpose: "translate-text",
        dialect: dialectForPrompt,
        strategy: "solo",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 4096,
        temperature: 0.2,
        // The generated Arabic is scaffold the learner studies from, so the
        // MSA scan reads every gloss (natural + literal + note).
        arabicTextPath: (p) => {
          const out = p as { sentences?: SentenceOut[] };
          return (out?.sentences ?? [])
            .map((s) => [s?.arabic, s?.literal, s?.note].filter(Boolean).join(" "))
            .join("\n");
        },
        tool: {
          name: "emit_translation",
          description: "Return the per-sentence nuanced translation.",
          parameters: {
            type: "object",
            properties: {
              sentences: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    english: { type: "string", description: "Sentence verbatim from input." },
                    arabic: { type: "string", description: "Fluent dialect-Arabic translation (never MSA)." },
                    literal: {
                      type: "string",
                      description:
                        "Word-for-word Arabic gloss preserving the English word order; may sound stiff; reveals sentence structure.",
                    },
                    note: {
                      type: "string",
                      description:
                        "Optional idiom / phrasal-verb / register note in the learner's dialect. Omit when not needed.",
                    },
                  },
                  required: ["english", "arabic", "literal"],
                },
              },
            },
            required: ["sentences"],
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

    const out = brain.output ?? { sentences: [] };

    const sentences: SentenceOut[] = Array.isArray(out.sentences)
      ? out.sentences
          .filter((s) => s && typeof s.english === "string" && s.english.trim().length > 0)
          .map((s) => ({
            english: String(s.english).trim(),
            arabic: String(s.arabic ?? "").trim(),
            literal: String(s.literal ?? "").trim(),
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
        // The key name is historical; it now reports the gloss dialect.
        detected_dialect: dialectForPrompt,
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
