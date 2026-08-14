// analyze-english-text — paste a chunk of real ENGLISH, get it broken down for
// an Arabic-speaking learner: line by line with a dialect translation, an MSA
// rendering, a word-for-word gloss in English order, the vocabulary worth
// keeping, the grammar the line demonstrates, and a cultural note when the
// English carries something an Arabic speaker would read straight past.
//
// The Arabic-target counterpart (analyze-gulf-arabic) exists for the
// Hakiya-bridged clips and stays as it is. This one is for English in the
// wild — an X post, an email, a comment thread — and returns the same
// TranscriptResult shape the transcript components already render, with
// `english` set on every line so they take the English-first path.
//
// The Brain call stays ARABIC-target: everything it generates is the scaffold,
// so the dialect machinery (identity, rulebook, MSA scan) guards it. The
// English is quoted from the input, not generated.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const MAX_CHARS = 4000;

interface AnalyzedLine {
  english: string;
  arabic: string;
  fusha?: string;
  literal?: string;
}

interface AnalyzedVocab {
  english: string;
  arabic: string;
  note?: string;
}

interface AnalyzedGrammar {
  title: string;
  explanation: string;
  examples?: string[];
}

interface BrainOut {
  lines?: AnalyzedLine[];
  vocabulary?: AnalyzedVocab[];
  grammarPoints?: AnalyzedGrammar[];
  culturalContext?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // No daily cap and verify_jwt = false, matching analyze-gulf-arabic, the
  // function this replaces: /learn-from-x has no route guard, so a signed-out
  // visitor can read a post and only saving a word is gated. Tightening that
  // is a product decision about the whole open-analyser posture, not
  // something to change by the back door while flipping the language.
  try {
    const body = await req.json().catch(() => ({}));
    const rawText = str(body?.text);
    const requestedDialect = str(body?.dialect);

    if (!rawText) {
      return new Response(JSON.stringify({ success: false, error: "missing_text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (rawText.length > MAX_CHARS) {
      return new Response(
        JSON.stringify({ success: false, error: "text_too_long", limit: MAX_CHARS }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // The dialect picks which Arabic the scaffold is written in — it names the
    // learner's first language, not anything about the English.
    const dialect: Dialect =
      requestedDialect === "Egyptian" || requestedDialect === "Yemeni" || requestedDialect === "Gulf"
        ? (requestedDialect as Dialect)
        : "Gulf";
    const dialectLabel = getDialectLabel(dialect);

    const systemExtra = `You are an English coach for a native ${dialectLabel} Arabic speaker. You will be given a short piece of real English — a social post, a message, an email. Break it down so the learner can actually read it.

For each natural sentence, return:
- english: the sentence VERBATIM from the input. Same words, same spelling, same punctuation. Never rewrite, correct or tidy it — informal English, typos and slang are the point.
- arabic: a fluent, natural ${dialectLabel} translation (authentic spoken dialect, NEVER Modern Standard Arabic / فصحى).
- fusha: the same sentence in Modern Standard Arabic.
- literal: a word-for-word Arabic gloss that keeps the ENGLISH word order, so the learner can see how the sentence is built. It will sound stiff in Arabic — that is the point. Never merge it with the natural translation.

Then return:
- vocabulary: the words and fixed phrases worth keeping — pick what a ${dialectLabel} speaker would not already know or would misread, favouring phrasal verbs, slang, abbreviations and idioms over easy nouns. english is the item exactly as it appears in the text; arabic is its ${dialectLabel} meaning; note (optional, in ${dialectLabel}) explains register or a false friend.
- grammarPoints: up to 3 English structures this text demonstrates, favouring what Arabic speakers get wrong (articles, the missing "to be", third-person -s, prepositions, word order, countability). title and explanation are written IN ${dialectLabel} ARABIC — that is the language the learner thinks in — and may name the English structure in English inside the Arabic sentence. examples quote real ENGLISH lines from the text.
- culturalContext: ONLY when the text leans on something an Arabic speaker would read straight past — sarcasm, a meme, a reference, a register shift. Written in ${dialectLabel}. Omit otherwise.

Do not invent sentences that are not in the input. Return ONLY the structured tool call.`;

    const userPrompt = `Break down the following English for a ${dialectLabel} speaker.\n\n"""\n${rawText}\n"""`;

    let brain;
    try {
      brain = await askBrain<BrainOut>({
        purpose: "analyze-english-text",
        dialect,
        strategy: "solo",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 4096,
        temperature: 0.2,
        // The MSA scan reads only what is meant to be dialect. The fusha lines
        // are deliberate MSA and the literal glosses are intentionally
        // unnatural, so both are kept out of it.
        arabicTextPath: (p) => {
          const out = p as BrainOut;
          return [
            ...(out?.lines ?? []).map((l) => str(l?.arabic)),
            ...(out?.vocabulary ?? []).map((v) => [str(v?.arabic), str(v?.note)].filter(Boolean).join(" ")),
            ...(out?.grammarPoints ?? []).map((g) => [str(g?.title), str(g?.explanation)].filter(Boolean).join(" ")),
            str(out?.culturalContext),
          ]
            .filter(Boolean)
            .join("\n");
        },
        tool: {
          name: "emit_analysis",
          description: "Return the English breakdown with its Arabic scaffold.",
          parameters: {
            type: "object",
            properties: {
              lines: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    english: { type: "string", description: "Sentence verbatim from the input." },
                    arabic: { type: "string", description: "Fluent dialect-Arabic translation (never MSA)." },
                    fusha: { type: "string", description: "The same sentence in Modern Standard Arabic." },
                    literal: {
                      type: "string",
                      description:
                        "Word-for-word Arabic gloss preserving the English word order; may sound stiff; reveals sentence structure.",
                    },
                  },
                  required: ["english", "arabic"],
                },
              },
              vocabulary: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    english: { type: "string", description: "The word or phrase as it appears in the text." },
                    arabic: { type: "string", description: "Its meaning in the learner's dialect." },
                    note: { type: "string", description: "Optional register / false-friend note in the dialect." },
                  },
                  required: ["english", "arabic"],
                },
              },
              grammarPoints: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string", description: "Short Arabic title naming the pattern." },
                    explanation: { type: "string", description: "1-3 sentences in the learner's dialect." },
                    examples: {
                      type: "array",
                      items: { type: "string" },
                      description: "Real English lines quoted from the text.",
                    },
                  },
                  required: ["title", "explanation"],
                },
              },
              culturalContext: {
                type: "string",
                description: "Optional note in the learner's dialect. Omit when the text needs none.",
              },
            },
            required: ["lines"],
          },
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = (e as { status?: number })?.status ?? 502;
      console.error("[analyze-english-text] brain error", status, msg);
      return new Response(
        JSON.stringify({ success: false, error: "ai_failed", detail: msg.slice(0, 400) }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const out = brain.output ?? {};

    const lines = (Array.isArray(out.lines) ? out.lines : [])
      .filter((l) => str(l?.english).length > 0)
      .map((l, i) => ({
        id: `line-${i}`,
        // `english` set is what tells the transcript components this is an
        // English line; `arabic` is the scaffold beneath it, not the spoken
        // line. See the convention in src/types/transcript.ts.
        english: str(l.english),
        arabic: str(l.arabic),
        translation: str(l.arabic),
        ...(str(l.fusha) ? { fusha: str(l.fusha) } : {}),
        ...(str(l.literal) ? { literal: str(l.literal) } : {}),
        // Tapping a word goes through TappableEnglishText, which tokenises the
        // English itself — there is nothing to precompute here.
        tokens: [],
      }));

    if (lines.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "empty_analysis", raw: brain.raw?.slice(0, 400) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vocabulary = (Array.isArray(out.vocabulary) ? out.vocabulary : [])
      .filter((v) => str(v?.english).length > 0)
      .map((v) => ({
        // VocabItem keeps its Arabic-era field names: `english` is the item
        // being learned, `arabic` its gloss.
        english: str(v.english),
        arabic: str(v.arabic),
        ...(str(v.note) ? { note: str(v.note) } : {}),
      }));

    const grammarPoints = (Array.isArray(out.grammarPoints) ? out.grammarPoints : [])
      .filter((g) => str(g?.title).length > 0)
      .map((g) => ({
        title: str(g.title),
        explanation: str(g.explanation),
        ...(Array.isArray(g.examples)
          ? { examples: g.examples.map(str).filter((e) => e.length > 0) }
          : {}),
      }));

    return new Response(
      JSON.stringify({
        success: true,
        result: {
          // Historical field name — it holds the source text, which is now
          // English. The page shows it above the breakdown.
          rawTranscriptArabic: rawText,
          lines,
          vocabulary,
          grammarPoints,
          ...(str(out.culturalContext) ? { culturalContext: str(out.culturalContext) } : {}),
          dialect,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[analyze-english-text] error", msg);
    return new Response(
      JSON.stringify({ success: false, error: "server_error", detail: msg.slice(0, 400) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
