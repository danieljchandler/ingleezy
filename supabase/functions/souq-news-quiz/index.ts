import type { Dialect } from "../_shared/dialectHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dialect = "Gulf", title_english, body_english, title_arabic, summary_arabic } = await req.json();

    if (!body_english) {
      return new Response(
        JSON.stringify({ error: "body_english is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemExtra = `You are creating a reading comprehension quiz based on a news article the learner just read in ENGLISH.
Generate exactly 3 multiple-choice questions that test the reader's understanding of the article content.
- question_english and each choice's "english" are the reading task: simple, natural English at the article's level.
- question_arabic and each choice's "arabic" are dialect-Arabic glosses of that English, never MSA — a safety net, not the task.
- Each question has exactly 4 choices; exactly one is correct.
- Include a mix of: factual recall, vocabulary meaning, and inference.
- Provide a brief explanation for the correct answer in the learner's dialect Arabic.
Return the questions via the provided tool only.`;

    const userPrompt = `Create a comprehension quiz for this English news article:\n\nHeadline (English): ${title_english}\nStory (English): ${body_english}\nHeadline (Arabic): ${title_arabic}\nSummary (Arabic): ${summary_arabic}`;

    try {
      const brain = await askBrain<{ questions: any[] }>({
        purpose: "news_quiz",
        dialect: dialect as Dialect,
        target: "english",
        strategy: "ensemble",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 2048,
        temperature: 0.5,
        tool: {
          name: "emit_quiz",
          description: "Return exactly 3 English comprehension questions with dialect glosses.",
          parameters: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question_english: { type: "string" },
                    question_arabic: { type: "string" },
                    choices: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          english: { type: "string" },
                          arabic: { type: "string" },
                          correct: { type: "boolean" },
                        },
                        required: ["english", "arabic", "correct"],
                      },
                    },
                    explanation: { type: "string" },
                  },
                  required: ["question_english", "question_arabic", "choices", "explanation"],
                },
              },
            },
            required: ["questions"],
          },
        },
      });
      return new Response(
        JSON.stringify({ questions: brain.output?.questions ?? [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (e: any) {
      console.error("souq-news-quiz brain error:", e?.status, e?.message);
      return new Response(
        JSON.stringify({ error: e?.status === 429 ? "Rate limit exceeded" : "Quiz generation failed" }),
        { status: e?.status ?? 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (e) {
    console.error("souq-news-quiz error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
