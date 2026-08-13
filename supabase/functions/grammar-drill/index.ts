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

    const systemExtra = `You are a ${dialectLabel} grammar teacher. Generate exactly 5 multiple-choice grammar drill questions.
Category: ${category || "mixed"}
Difficulty: ${difficulty || "beginner"}
Each question tests a specific ${dialectLabel} grammar concept (verb conjugation, pronouns, sentence structure, negation, possessives, etc.).
All Arabic text MUST be authentic ${dialectLabel}, never MSA.
Return the questions via the provided tool only.

${learnerBlock}`;

    const userPrompt = `Generate 5 ${difficulty || "beginner"} level ${dialectLabel} grammar questions about "${category || "mixed grammar"}". Each question should have the Arabic text, an English explanation of what's being tested, 4 answer choices (with Arabic text + English gloss), and indicate the correct answer index (0-3). Include a brief explanation for why the correct answer is right.`;

    try {
      const brain = await askBrain<{ questions: any[] }>({
        purpose: "grammar_drill",
        dialect: dialect as Dialect,
        strategy: "ensemble",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 2048,
        temperature: 0.5,
        arabicTextPath: (p: any) => (Array.isArray(p?.questions) ? p.questions.map((q: any) => [q?.question_arabic, ...(Array.isArray(q?.choices) ? q.choices.map((c: any) => c?.text_arabic) : [])].filter(Boolean).join(" ")).join("\n") : ""),
        tool: {
          name: "suggest_questions",
          description: "Return 5 grammar drill questions in the target dialect.",
          parameters: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question_arabic: { type: "string" },
                    question_english: { type: "string" },
                    grammar_point: { type: "string" },
                    choices: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { text_arabic: { type: "string" }, text_english: { type: "string" } },
                        required: ["text_arabic", "text_english"],
                      },
                    },
                    correct_index: { type: "number" },
                    explanation: { type: "string" },
                  },
                  required: ["question_arabic", "question_english", "grammar_point", "choices", "correct_index", "explanation"],
                },
              },
            },
            required: ["questions"],
          },
        },
      });

      if (brain.msaLeaks.leaks.length > 0) {
        console.warn("grammar-drill MSA leaks after repair:", brain.msaLeaks.leaks, "repairs:", brain.msaRepairs);
      }

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
