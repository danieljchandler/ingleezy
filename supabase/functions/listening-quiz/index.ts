import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, getTashkeelMandate, getDialectTransliterationRules, type Dialect } from "../_shared/dialectHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


interface QuizQuestion {
  type: "dictation" | "comprehension" | "speed";
  audioText: string;
  audioTextTransliteration?: string;
  audioTextEnglish: string;
  options?: { text: string; textArabic: string; correct: boolean }[];
  hint?: string;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "listening-quiz", 15, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { mode, words, count = 5, dialect = "Gulf", difficulty = "beginner" } = await req.json();

    const dialectLabel = getDialectLabel(dialect);

    const vocabContext = words
      .slice(0, 20)
      .map((w: any) => `${w.word_arabic} (${w.word_english})`)
      .join(", ");

    const levelGuidance = difficulty === "advanced"
      ? "Use complex, natural-speed sentences with advanced vocabulary and idioms."
      : difficulty === "intermediate"
      ? "Use moderately complex sentences with a mix of common and less common vocabulary."
      : "Use simple, slow, clearly pronounced sentences with basic vocabulary.";

    const systemExtra = `You are a ${dialectLabel} language tutor creating listening comprehension exercises.
- Generate exercises using these vocabulary words the student knows: ${vocabContext}
- Student level: ${difficulty}. ${levelGuidance}
- All audioText fields MUST be authentic ${dialectLabel}, never MSA.

${getTashkeelMandate()}
- Every audioText field must be fully vocalized — these are read aloud by text-to-speech and unvocalized text causes mispronunciation.

${getDialectTransliterationRules(dialect as Dialect)}
- Provide a Latin-letter transliteration for every audioText as audioTextTransliteration.

- Return the structured questions via the provided tool only.`;

    let userPrompt = "";
    if (mode === "dictation") {
      userPrompt = `Generate ${count} ${dialectLabel} sentences for dictation practice. Each item: type="dictation", a ${dialectLabel} audioText, an English audioTextEnglish, and a short hint (e.g. first word).`;
    } else if (mode === "comprehension") {
      userPrompt = `Generate ${count} listening comprehension questions in ${dialectLabel}. Each item: type="comprehension", a ${dialectLabel} audioText sentence, an English audioTextEnglish, and 3 options (one correct). Each option has text (English meaning), textArabic (short ${dialectLabel}), and correct boolean.`;
    } else {
      userPrompt = `Generate ${count} short ${dialectLabel} phrases (2-4 words) for speed listening practice. Each item: type="speed", audioText in ${dialectLabel}, audioTextEnglish in English.`;
    }

    let questions: QuizQuestion[] = [];
    try {
      const brain = await askBrain<{ questions: QuizQuestion[] }>({
        purpose: "listening_quiz",
        dialect: dialect as Dialect,
        strategy: "ensemble",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 2048,
        temperature: 0.7,
        arabicTextPath: (p: any) => (Array.isArray(p?.questions) ? p.questions.map((q: any) => q?.audioText ?? "").join("\n") : ""),
        tool: {
          name: "emit_listening_quiz",
          description: `Listening quiz items in ${dialectLabel}.`,
          parameters: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["dictation", "comprehension", "speed"] },
                    audioText: { type: "string" },
                    audioTextTransliteration: { type: "string" },
                    audioTextEnglish: { type: "string" },
                    hint: { type: "string" },
                    options: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          text: { type: "string" },
                          textArabic: { type: "string" },
                          correct: { type: "boolean" },
                        },
                        required: ["text", "textArabic", "correct"],
                      },
                    },
                  },
                  required: ["type", "audioText", "audioTextEnglish"],
                },
              },
            },
            required: ["questions"],
          },
        },
      });
      questions = Array.isArray(brain.output?.questions) ? brain.output.questions : [];
      if (brain.msaLeaks.leaks.length > 0) {
        console.warn("listening-quiz MSA leaks after repair:", brain.msaLeaks.leaks, "repairs:", brain.msaRepairs);
      }
    } catch (e: any) {
      console.error("listening-quiz brain error:", e?.status, e?.message);
      if (e?.status === 402) {
        return new Response(JSON.stringify({ error: "Not enough AI credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (e?.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const fallback = dialect === "Egyptian" ? "أهلاً" : "هلا";
      questions = [{ type: mode, audioText: fallback, audioTextEnglish: "Hello", hint: fallback[0] }];
    }

    return new Response(JSON.stringify({ questions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("listening-quiz error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
