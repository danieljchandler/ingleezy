import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { primeEnglishPrompt } from "../_shared/englishHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";
import { englishPassageGate } from "../_shared/passageQualityCore.ts";

/**
 * Wall-clock ceiling for the generation, kept under the client's own timeout so
 * a slow run surfaces as a real error with a retry rather than an unbounded
 * spinner. Deliberately below PASSAGE_TIMEOUT_MS (110s) in
 * src/pages/ReadingPractice.tsx, so a run that finishes just under the ceiling
 * isn't cut off by the browser anyway.
 *
 * This is a ceiling, not a target: the typical request finishes in one drafting
 * pass plus a short authenticity check, well inside it. It is sized to still fit
 * a draft *plus* the check *plus* a full rewrite when either gate demands one,
 * so bounding the pathological case never costs a passage that needed fixing.
 *
 * It was cut to 78s to "leave room for the MSA repair pass", which is backwards
 * — the repair pass runs *inside* this budget, and aiBrain skips both it and the
 * critic rewrite once fewer than MIN_PASS_BUDGET_MS (12s) remain. At 78s a draft
 * (up to 45s) plus the authenticity check (up to 20s) left barely 13s, so on
 * Yemeni the rewrite that was supposed to fix a fusha draft was routinely
 * skipped as "budget spent" and the draft shipped as-is. The reserve under the
 * client's timeout belongs here, not inside the pass accounting.
 */
const GENERATION_BUDGET_MS = 95_000;

/**
 * How long a passage should be, per difficulty.
 *
 * `minLines` is enforced three ways — stated in the prompt, set as `minItems`
 * on the tool schema, and checked by the quality gate so a short draft is sent
 * back for a rewrite rather than shipped. It needs all three: when the sentence
 * count lived only in a parenthetical aside in the prompt, the drafting model
 * happily returned two sentences for an intermediate passage. Nothing caught it
 * because the gate only rejected an *empty* lines array.
 */
const PASSAGE_SHAPE: Record<
  string,
  { minLines: number; maxLines: number; style: (label: string) => string }
> = {
  beginner: {
    minLines: 3,
    maxLines: 4,
    style: () => `short sentences, simple everyday English, common phrases`,
  },
  intermediate: {
    minLines: 5,
    maxLines: 6,
    style: () => `varied English vocabulary, common idioms and phrasal verbs`,
  },
  advanced: {
    minLines: 7,
    maxLines: 9,
    style: () => `complex structures, idiomatic natural English`,
  },
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Stage timings, logged on every request and returned to the caller. "It's
  // slow" is not diagnosable without knowing which stage ate the wall clock.
  const t0 = Date.now();
  const timing: Record<string, number> = {};
  const mark = (stage: string, from: number) => { timing[stage] = Date.now() - from; };

  try {
    const { difficulty = "beginner", topic, dialect = "Gulf" } = await req.json();

    // Warm the interference rulebook cache now. It depends on nothing else in
    // the request, so it has no business sitting behind the auth and
    // learner-profile round trips.
    const priming = primeEnglishPrompt(dialect as Dialect);

    // Free-tier daily cap
    const capStart = Date.now();
    const cap = await enforceDailyCap(req, "reading-passage", 15, corsHeaders);
    mark("cap", capStart);
    if (cap.limited) return cap.response;

    const dialectLabel = getDialectLabel(dialect);

    // Learner model, built server-side from the caller's real SRS state across
    // both decks. This replaces the old client-supplied `userVocab` argument,
    // which was fed the entire curriculum vocabulary shuffled (useAllWords) and
    // labelled "words the student knows" — so passages were being built around
    // words the learner had often never seen. Callers may still send `userVocab`;
    // it is deliberately ignored.
    const profileStart = Date.now();
    const [learnerBlock] = await Promise.all([
      learnerPromptBlock({ userId: cap.userId, dialect, target: "english" }),
      priming,
    ]);
    mark("profile+rules", profileStart);

    // Situations an Arabic-speaking learner actually needs English for.
    const culturalContext =
      "everyday situations an Arabic speaker meets English in — travel, work, shops, online, studies";

    const topicContext = topic ? `Topic: ${topic}` : `Topic: ${culturalContext}`;

    const shape = PASSAGE_SHAPE[difficulty] ?? PASSAGE_SHAPE.beginner;
    const difficultyGuide = `${shape.minLines}-${shape.maxLines} sentences, ${shape.style(dialectLabel)}`;

    const systemExtra = `You are an English instructor creating reading comprehension exercises for native ${dialectLabel} speakers.
- Set passages in engaging, realistic contexts.
- The passage text MUST be natural spoken-register English at the difficulty level — textbook stiffness is a defect.
- Every line carries its ${dialectLabel} Arabic translation as "arabic" (the learner's own dialect, never Fusha) and a "literal" gloss: the ${dialectLabel} words in ENGLISH word order, so the learner sees how the English sentence is built (stiffness expected there).
- Comprehension questions are in English with a ${dialectLabel} rendering as questionArabic; options are English with textArabic glosses.
- Return the structured fields via the provided tool only.

${learnerBlock}`;

    const userPrompt = `Write a short STORY in English for a ${difficulty} learner to read.

LENGTH (hard requirement): the "lines" array MUST contain at least ${shape.minLines} sentences, ideally ${shape.minLines}-${shape.maxLines}. A response with fewer than ${shape.minLines} will be rejected.

It must read as a story, not a couple of stray facts: something happens, in order — a setting, then events, then how it ends. ${difficultyGuide}.
${topicContext}

Put one sentence per entry in the "lines" array, each with its English text, its ${dialectLabel} translation, and the literal word-order gloss. Also generate 3-4 vocabulary items (English word + ${dialectLabel} meaning) and 2-3 comprehension questions about the story.`;

    let passage: any;
    let brainPasses: unknown[] = [];
    const brainStart = Date.now();
    try {
      const brain = await askBrain<any>({
        purpose: "reading_passage",
        dialect: dialect as Dialect,
        target: "english",
        strategy: "draft_critic",
        // No models[] override: this takes MODEL_LINEUPS.CONTENT, the same
        // Gemini 3.5 Flash + Claude tandem generate-daily-story uses.
        //
        // It briefly drafted on MODEL_IDS.GEMINI_FAST, added with a comment
        // calling it "the stable fast Gemini build rather than the lineup
        // default preview build". That has it backwards: GEMINI_FAST *is* the
        // preview build (google/gemini-3-flash-preview, the registry's
        // "cheapest utility default", weight 0.7) and the lineup default it
        // replaced is the stable google/gemini-3.5-flash at weight 1.0. So the
        // override swapped an authoritative drafter for the cheap utility model
        // — which every other caller uses for classification and scoring, not
        // for prose a learner reads as a model of the dialect. On Yemeni it
        // drafts fusha with dialect words dropped in, which is precisely the
        // register failure the prompt below spends a paragraph warning against.
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 3072,
        temperature: 0.8,
        budgetMs: GENERATION_BUDGET_MS,
        // What the critic pass is there to guarantee, stated as a check we can
        // run locally in microseconds: English + gloss + literal on every
        // line, vocabulary, an answerable quiz, enough lines. A draft that
        // already has all of it ships without paying the critic; anything
        // missing triggers the full rewrite. See _shared/passageQualityCore.ts.
        qualityGate: (parsed: unknown) => englishPassageGate(parsed, { minLines: shape.minLines }),
        tool: {
          name: "emit_reading_passage",
          description: `Reading passage in ${dialectLabel}.`,
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "English title" },
              titleArabic: { type: "string", description: "Dialect-Arabic rendering of the title" },
              lines: {
                type: "array",
                // Stated in the schema as well as the prompt: a bare prose
                // instruction was being ignored, and a two-sentence
                // "intermediate" passage is not a story.
                minItems: shape.minLines,
                items: {
                  type: "object",
                  properties: {
                    english: { type: "string", description: "One sentence of the story" },
                    arabic: { type: "string", description: "Dialect-Arabic translation of this sentence" },
                    literal: { type: "string", description: "Word-for-word Arabic gloss preserving the English word order" },
                  },
                  // `literal` is required here, not merely described: the quality
                  // gate below refuses a draft without it, and a schema that asks
                  // for it up front is much cheaper than a rewrite pass that adds it.
                  required: ["english", "arabic", "literal"],
                },
              },
              difficulty: { type: "string" },
              vocabulary: {
                type: "array",
                items: {
                  type: "object",
                  properties: { english: { type: "string" }, arabic: { type: "string" }, inContext: { type: "string" } },
                  required: ["english", "arabic"],
                },
              },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string", description: "The question, in English" },
                    questionArabic: { type: "string", description: "Dialect-Arabic rendering of the question" },
                    options: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { text: { type: "string", description: "Option in English" }, textArabic: { type: "string" }, correct: { type: "boolean" } },
                        required: ["text", "textArabic", "correct"],
                      },
                    },
                  },
                  required: ["question", "questionArabic", "options"],
                },
              },
            },
            required: ["title", "titleArabic", "lines", "vocabulary", "questions"],
          },
        },
      });
      passage = brain.output;
      brainPasses = brain.passes ?? [];
      mark("generate", brainStart);
    } catch (e: any) {
      mark("generate", brainStart);
      console.error("reading-passage brain error:", e?.status, e?.message);
      if (e?.status === 402) {
        return new Response(JSON.stringify({ error: "Not enough AI credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (e?.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // No stub passage. There used to be a hardcoded two-sentence market story
      // here, served with a 200 as though it were real content — no
      // transliteration, no literal gloss, the same text every time, and
      // indistinguishable to the learner from a genuine generation. Now that
      // generation carries a deadline this path is reachable on a slow run, and
      // a silent two-line passage is exactly the failure it would look like.
      // The client already handles an error by offering a retry, which is the
      // honest outcome.
      return new Response(
        JSON.stringify({ error: "Could not generate a passage right now. Please try again." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    timing.total = Date.now() - t0;
    console.log(
      `[reading-passage] ${difficulty}/${dialect} total=${timing.total}ms`,
      timing,
      brainPasses,
    );

    // `_timing` is diagnostic only — the client reads `passage`. It is here so a
    // slow generation can be attributed from the browser's network tab without
    // needing access to the function logs.
    return new Response(JSON.stringify({ passage, _timing: { ...timing, passes: brainPasses } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("reading-passage error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
