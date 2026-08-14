import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { resolveUserId } from "../_shared/usageCap.ts";
import { normalizeDialect } from "../_shared/transcriptDiffCore.ts";

// Service-role client for the placement_history trajectory, cached per
// isolate like every other function's.
let cachedHistoryClient: ReturnType<typeof createClient> | null = null;
function historyClient() {
  if (!cachedHistoryClient) {
    cachedHistoryClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cachedHistoryClient;
}


const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

function adjustDifficulty(history: { correct: boolean; difficulty: string }[]): string {
  if (history.length === 0) return "B1";
  const lastFive = history.slice(-5);
  const correctCount = lastFive.filter((h) => h.correct).length;
  const currentIdx = CEFR_LEVELS.indexOf(lastFive[lastFive.length - 1].difficulty);
  if (correctCount >= 4 && currentIdx < CEFR_LEVELS.length - 1) return CEFR_LEVELS[currentIdx + 1];
  if (correctCount <= 1 && currentIdx > 0) return CEFR_LEVELS[currentIdx - 1];
  return CEFR_LEVELS[Math.max(0, currentIdx)];
}

function calculateCEFR(history: { correct: boolean; difficulty: string; skill_type: string }[]): {
  cefr_level: string;
  confidence: number;
  strengths: string[];
  weaknesses: string[];
} {
  // Weight correct answers by difficulty level
  let totalScore = 0;
  let maxScore = 0;
  const skillScores: Record<string, { correct: number; total: number }> = {};

  for (const h of history) {
    const diffWeight = CEFR_LEVELS.indexOf(h.difficulty) + 1;
    maxScore += diffWeight;
    if (h.correct) totalScore += diffWeight;

    if (!skillScores[h.skill_type]) skillScores[h.skill_type] = { correct: 0, total: 0 };
    skillScores[h.skill_type].total++;
    if (h.correct) skillScores[h.skill_type].correct++;
  }

  const ratio = totalScore / maxScore;
  // Map ratio to CEFR
  let levelIdx: number;
  if (ratio >= 0.85) levelIdx = 5; // C2
  else if (ratio >= 0.7) levelIdx = 4; // C1
  else if (ratio >= 0.55) levelIdx = 3; // B2
  else if (ratio >= 0.4) levelIdx = 2; // B1
  else if (ratio >= 0.25) levelIdx = 1; // A2
  else levelIdx = 0; // A1

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const [skill, scores] of Object.entries(skillScores)) {
    const pct = scores.correct / scores.total;
    if (pct >= 0.7) strengths.push(skill);
    else if (pct < 0.4) weaknesses.push(skill);
  }

  return {
    cefr_level: CEFR_LEVELS[levelIdx],
    confidence: Math.round(ratio * 100),
    strengths: strengths.length ? strengths : ["general_comprehension"],
    weaknesses: weaknesses.length ? weaknesses : [],
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, current_difficulty, question_number, history, dialect } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // The learner's assessment trajectory (C4) — server-written rows only,
    // so the chart can't be self-reported.
    if (action === "history") {
      const userId = await resolveUserId(req);
      if (!userId) {
        return new Response(JSON.stringify({ error: "auth_required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: rows, error: historyErr } = await historyClient()
        .from("placement_history")
        .select("dialect, cefr_level, confidence, taken_at")
        .eq("user_id", userId)
        .order("taken_at", { ascending: true })
        .limit(100);
      if (historyErr) {
        return new Response(JSON.stringify({ error: historyErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ history: rows ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Score action — no AI needed
    if (action === "score") {
      const result = calculateCEFR(history || []);
      // Append the trajectory row (fire-and-forget: scoring must not fail on
      // bookkeeping). Anonymous callers simply record nothing.
      try {
        const userId = await resolveUserId(req);
        const scoredDialect = normalizeDialect(dialect);
        if (userId && scoredDialect) {
          historyClient()
            .from("placement_history")
            .insert([
              {
                user_id: userId,
                dialect: scoredDialect,
                cefr_level: result.cefr_level,
                confidence: Math.max(0, Math.min(100, Math.round(result.confidence ?? 0))),
              },
            ] as unknown as never)
            .then(
              ({ error }: { error: { message: string } | null }) => {
                if (error) console.warn("[placement-quiz] history insert failed:", error.message);
              },
              (err: unknown) => console.warn("[placement-quiz] history insert threw:", err),
            );
        }
      } catch (e) {
        console.warn("[placement-quiz] history record failed:", e);
      }
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate questions
    const difficulty = current_difficulty || adjustDifficulty(history || []);
    const batchNum = Math.floor((question_number || 0) / 5) + 1;
    const dialectName = dialect || "Gulf";

    const historyStr =
      history && history.length > 0
        ? `Previous performance: ${history.filter((h: any) => h.correct).length}/${history.length} correct. `
        : "";

    const prompt = `You are an ENGLISH placement test generator for native ${dialectName} Arabic speakers.

${historyStr}Generate exactly 5 multiple-choice questions at CEFR level ${difficulty} (batch ${batchNum}/4).

Mix these question types across the 5 questions:
- vocabulary: Match an English word to its meaning (English word with Arabic choices, or Arabic word with English choices)
- grammar: English fill-in-the-blank or choose the correct form — favour the points that trip Arabic speakers (articles, prepositions, third-person -s, tense)
- reading: Short English sentence/passage with a comprehension question
- translation: Pick the natural English rendering of a short Arabic phrase

IMPORTANT RULES:
- The English is the thing being tested: contemporary, natural English at ${difficulty} level.
- question_arabic is the question prompt in the learner's OWN dialect (authentic ${dialectName} Arabic, NOT MSA) so a true beginner understands the task; question_english is the same prompt in English.
- Each question must have exactly 4 choices; "text" is the choice in English, "text_arabic" its ${dialectName} gloss.
- Vary the skill types across the batch.
- At A1-A2 keep the Arabic support full; from B1 up the questions may lean more English-only.

Return a JSON object with this exact structure:
{
  "questions": [
    {
      "question_arabic": "the question prompt in the learner's dialect Arabic",
      "question_english": "the question prompt in English",
      "skill_type": "vocabulary|grammar|reading|translation",
      "difficulty": "${difficulty}",
      "choices": [
        {"text": "choice 1", "text_arabic": "الخيار ١"},
        {"text": "choice 2", "text_arabic": "الخيار ٢"},
        {"text": "choice 3", "text_arabic": "الخيار ٣"},
        {"text": "choice 4", "text_arabic": "الخيار ٤"}
      ],
      "correct_index": 0
    }
  ],
  "suggested_difficulty": "${difficulty}"
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages: [
          { role: "system", content: "You are a precise English language assessment tool for Arabic-speaking learners. Always respond with valid JSON only, no markdown fences." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "placement_questions",
              description: "Return placement quiz questions",
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
                        skill_type: { type: "string", enum: ["vocabulary", "grammar", "reading", "translation"] },
                        difficulty: { type: "string" },
                        choices: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              text: { type: "string" },
                              text_arabic: { type: "string" },
                            },
                            required: ["text", "text_arabic"],
                          },
                        },
                        correct_index: { type: "number" },
                      },
                      required: ["question_arabic", "question_english", "skill_type", "difficulty", "choices", "correct_index"],
                    },
                  },
                  suggested_difficulty: { type: "string" },
                },
                required: ["questions", "suggested_difficulty"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "placement_questions" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any;

    if (toolCall?.function?.arguments) {
      parsed = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    } else {
      // Fallback: try parsing content directly
      const content = aiResult.choices?.[0]?.message?.content || "";
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    // Validate we got questions
    if (!parsed?.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      throw new Error("Invalid response structure from AI");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("placement-quiz error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
