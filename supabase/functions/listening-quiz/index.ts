import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


// Column names are Arabic-era; the content flipped with the app's direction:
// - audioText           — the ENGLISH sentence the learner hears (the target)
// - audioTextTransliteration — phonetic_ar: the English in Arabic letters
// - audioTextEnglish    — the ARABIC gloss in the learner's dialect
// - options.text        — comprehension option: the meaning, in the dialect
// - options.textArabic  — that option restated in English (secondary line)
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

    const cefr = difficulty === "advanced" ? "B2" : difficulty === "intermediate" ? "B1" : "A2";

    const systemExtra = `You are an English tutor for native ${dialectLabel} speakers, creating listening exercises.
- Generate exercises using these vocabulary words the student knows: ${vocabContext}
- Student level: ${difficulty}. ${levelGuidance}
- audioText is the ENGLISH the student hears — natural, contemporary spoken English.
- audioTextEnglish carries the ${dialectLabel} gloss of the sentence, in Arabic script, authentic ${dialectLabel} (never MSA).
- audioTextTransliteration is the English sentence rendered phonetically in ARABIC letters (e.g. "ثانك يو" for "thank you") so the student can read how it sounds.

- Return the structured questions via the provided tool only.`;

    let userPrompt = "";
    if (mode === "dictation") {
      userPrompt = `Generate ${count} English sentences for dictation practice. Each item: type="dictation", an English audioText, its ${dialectLabel} gloss as audioTextEnglish, and a short hint (the first word of the English sentence).`;
    } else if (mode === "comprehension") {
      userPrompt = `Generate ${count} listening comprehension questions. Each item: type="comprehension", an English audioText sentence, its ${dialectLabel} gloss as audioTextEnglish, and 3 options (one correct) asking what the sentence means. Each option has text (the meaning in ${dialectLabel} Arabic script), textArabic (the same option in English), and correct boolean.`;
    } else {
      userPrompt = `Generate ${count} short English phrases (2-4 words) for speed listening practice. Each item: type="speed", audioText in English, audioTextEnglish as the ${dialectLabel} gloss.`;
    }

    let questions: QuizQuestion[] = [];
    try {
      const brain = await askBrain<{ questions: QuizQuestion[] }>({
        purpose: "listening_quiz",
        target: "english",
        cefr,
        dialect: dialect as Dialect,
        strategy: "ensemble",
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 2048,
        temperature: 0.7,
        tool: {
          name: "emit_listening_quiz",
          description: `English listening quiz items glossed in ${dialectLabel}.`,
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
      const fallbackGloss = dialect === "Egyptian" ? "أهلاً" : "هلا";
      questions = [{ type: mode, audioText: "Hello", audioTextEnglish: fallbackGloss, hint: "Hello" }];
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
