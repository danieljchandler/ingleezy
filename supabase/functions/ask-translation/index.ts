// Ask AI questions about a sentence and its translation. Streams via the shared
// Brain so the tutor's inline dialect examples inherit the dialect identity,
// vocab rulebook, and MSA-leak logging/repair pipeline.
import { streamBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getDialectLabel, getDialectTransliterationRules, type Dialect } from "../_shared/dialectHelpers.ts";
import { DEFAULT_FAST } from "../_shared/modelRegistry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  arabic: string;
  english?: string;
  dialect?: Dialect;
  messages: ChatMessage[];
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, "ask-translation", 40, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const body = (await req.json()) as RequestBody;
    const { arabic, english, dialect, messages } = body;

    if (!arabic || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "arabic and messages are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resolvedDialect: Dialect = dialect || "Gulf";
    const dialectLabel = getDialectLabel(resolvedDialect);

    const systemPromptExtra = `You are a friendly, expert Arabic language tutor specializing in ${dialectLabel}.
A learner is studying this sentence and may ask anything about it (translation choices, grammar, vocabulary, cultural nuance, alternative phrasings, pronunciation hints, etymology, related expressions, etc.).

THE SENTENCE:
Arabic: ${arabic}
${english ? `English translation provided: ${english}` : "(no English translation provided)"}

${getDialectTransliterationRules(resolvedDialect)}

GUIDELINES:
- Answer the learner's question directly and clearly in English (since they are learning).
- When showing Arabic words/phrases, use the script then a transliteration in parentheses following the transliteration rules above, e.g. شلونك (shlonak).
- Explain WHY translations are phrased a certain way — idioms, word order, register, dialect-specific choices.
- Keep answers concise but rich. Use short paragraphs or bullet points. Markdown is rendered.
- If the learner asks for "more", expand with examples, related vocabulary, or cultural context.
- Stay scoped to this sentence and Arabic learning. Politely decline unrelated topics.`;

    return await streamBrain({
      purpose: "ask_translation",
      dialect: resolvedDialect,
      messages,
      systemPromptExtra,
      model: DEFAULT_FAST,
      maxTokens: 1024,
      responseHeaders: corsHeaders,
      signal: req.signal,
    });
  } catch (err) {
    const corsHeaders = getCorsHeaders(req);
    if (err instanceof BrainHttpError) {
      if (err.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit reached. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (err.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    console.error("ask-translation error", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
