import type { Dialect } from "../_shared/dialectHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dialect = "Gulf", title_dialect, body_dialect, title_english, summary_english } = await req.json();

    if (!body_dialect) {
      return new Response(
        JSON.stringify({ error: "body_dialect is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemExtra = `You are creating a reading comprehension quiz based on a news article written in dialect.
Generate exactly 3 multiple-choice questions that test the reader's understanding of the article content.
- Questions and Arabic choices MUST be authentic dialect, never MSA.
- Each question has exactly 4 choices; exactly one is correct.
- Include a mix of: factual recall, vocabulary meaning, and inference.
- Provide a brief explanation for the correct answer (in English).
Return the questions via the provided tool only.`;

    const userPrompt = `Create a comprehension quiz for this dialect news article:\n\nHeadline (Arabic): ${title_dialect}\nStory (Arabic): ${body_dialect}\nHeadline (English): ${title_english}\nSummary (English): ${summary_english}`;

    try {
      const brain = await askBrain<{ questions: any[] }>({
        purpose: "news_quiz",
        dialect: dialect as Dialect,
        strategy: "ensemble",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 2048,
        temperature: 0.5,
        arabicTextPath: (p: any) => (Array.isArray(p?.questions) ? p.questions.map((q: any) => [q?.question_arabic, ...(Array.isArray(q?.choices) ? q.choices.map((c: any) => c?.arabic) : [])].filter(Boolean).join(" ")).join("\n") : ""),
        tool: {
          name: "emit_quiz",
          description: "Return exactly 3 dialect comprehension questions.",
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
                    choices: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          arabic: { type: "string" },
                          english: { type: "string" },
                          correct: { type: "boolean" },
                        },
                        required: ["arabic", "english", "correct"],
                      },
                    },
                    explanation: { type: "string" },
                  },
                  required: ["question_arabic", "question_english", "choices", "explanation"],
                },
              },
            },
            required: ["questions"],
          },
        },
      });
      if (brain.msaLeaks.leaks.length > 0) {
        console.warn("souq-news-quiz MSA leaks after repair:", brain.msaLeaks.leaks, "repairs:", brain.msaRepairs);
      }
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
