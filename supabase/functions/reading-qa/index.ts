import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectVocabRules, getDialectLabel, getDialectIdentity } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, difficulty = "beginner", dialect = "Gulf", history = [] } = await req.json();

    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Question is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);
    const dialectIdentity = getDialectIdentity(dialect);

    const difficultyGuide: Record<string, string> = {
      beginner: `Use simple, everyday ${dialectLabel} vocabulary. Short sentences (3-6 words). Common greetings and phrases.`,
      intermediate: `Use varied ${dialectLabel} vocabulary with colloquial expressions. Medium-length sentences with some cultural references.`,
      advanced: `Use complex structures, idiomatic ${dialectLabel} expressions, and nuanced vocabulary. Longer, natural sentences.`,
    };

    const systemPrompt = `${dialectIdentity}

You are a friendly and knowledgeable language partner helping someone learn ${dialectLabel}.
The student asks you questions about any topic. You answer naturally in ${dialectLabel} dialect at the "${difficulty}" level.

${dialectRules}

${difficultyGuide[difficulty] || difficultyGuide.beginner}

IMPORTANT RULES:
- Answer the student's question directly and naturally in ${dialectLabel} dialect.
- Keep your answer 3-6 sentences long depending on difficulty.
- Be conversational and warm, as if chatting with a friend.
- Include culturally relevant details when appropriate.
- Return valid JSON only, no markdown code blocks.

Return JSON in this exact format:
{
  "lines": [
    {"arabic": "One sentence in ${dialectLabel}", "english": "English translation of that sentence"}
  ],
  "vocabulary": [{"arabic": "word", "english": "meaning", "inContext": "how it's used in the answer"}],
  "followUp": "A suggested follow-up question in English the student could ask next"
}`;

    // Build conversation messages
    const messages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    // Add conversation history
    for (const msg of history) {
      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant" && msg.content) {
        messages.push({ role: "assistant", content: msg.content });
      }
    }

    // Add the current question
    messages.push({ role: "user", content: question });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Not enough AI credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      console.error("Failed to parse QA response:", e, content);
      parsed = {
        lines: [
          { arabic: "عذراً، ما قدرت أجاوب. جرب تسأل سؤال ثاني.", english: "Sorry, I couldn't answer. Try asking another question." },
        ],
        vocabulary: [],
        followUp: "Try asking a simpler question",
      };
    }

    return new Response(JSON.stringify({ answer: parsed, rawContent: content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("reading-qa error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
