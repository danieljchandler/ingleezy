import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "grammar-drill", 20, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { category, difficulty, dialect = "Gulf" } = await req.json();
    const dialectLabel = getDialectLabel(dialect);

    // Drills built from the learner's own lexicon test the grammar point rather
    // than doubling as an unintended vocabulary test. Interests are irrelevant
    // to a conjugation drill, so they're left out.
    const learnerBlock = await learnerPromptBlock({
      userId: cap.userId,
      dialect,
      budget: { known: 60, learning: 15, weak: 10 },
      includeInterests: false,
    });

    const systemExtra = `You are an English grammar teacher for native ${dialectLabel} speakers. Generate exactly 5 multiple-choice grammar drill questions.
Category: ${category || "mixed"}
Difficulty: ${difficulty || "beginner"}
Each question tests a specific ENGLISH grammar concept, built to catch the errors Arabic speakers actually make in that category (see the interference patterns above — a drill whose wrong options are the Arabic-shaped forms teaches twice).
The question sentence and all choices are English; the instruction line and the explanation are in ${dialectLabel} Arabic — grammar explained in the learner's own language.
Return the questions via the provided tool only.

${learnerBlock}`;

    const userPrompt = `Generate 5 ${difficulty || "beginner"} level English grammar questions about "${category || "mixed grammar"}". Each question has: the English sentence/question being tested (often with a blank), a short ${dialectLabel} instruction line, 4 answer choices in English (each with a ${dialectLabel} gloss), the correct answer index (0-3), and a brief explanation in ${dialectLabel} of why the correct answer is right — naming the Arabic-transfer trap when there is one.`;

    try {
      const brain = await askBrain<{ questions: any[] }>({
        purpose: "grammar_drill",
        dialect: dialect as Dialect,
        target: "english",
        strategy: "ensemble",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 2048,
        temperature: 0.5,
        tool: {
          name: "suggest_questions",
          description: "Return 5 English grammar drill questions with dialect-Arabic support.",
          parameters: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string", description: "The English sentence/question being tested, often with a blank" },
                    question_ar: { type: "string", description: "Short instruction line in the learner's dialect" },
                    grammar_point: { type: "string" },
                    choices: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { text: { type: "string" }, text_ar: { type: "string" } },
                        required: ["text", "text_ar"],
                      },
                    },
                    correct_index: { type: "number" },
                    explanation_ar: { type: "string", description: "Why the correct answer is right, in the learner's dialect, naming the Arabic-transfer trap when there is one" },
                  },
                  required: ["question", "question_ar", "grammar_point", "choices", "correct_index", "explanation_ar"],
                },
              },
            },
            required: ["questions"],
          },
        },
      });

      return new Response(JSON.stringify(brain.output), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: any) {
      if (e?.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (e?.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }
  } catch (e) {
    console.error("grammar-drill error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
