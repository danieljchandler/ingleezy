// free-chat — streaming dialect-aware Arabic tutor chat via the AI Brain.
// The Brain owns the dialect identity + vocab rules system block; this file
// just appends the tutor-specific conversation/correction rules.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { streamBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { detectMsaLeaks } from "../_shared/msaLeakDetector.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const LEVEL_GUIDANCE: Record<string, string> = {
  A1: "Use VERY simple, short sentences (3–6 words). Stick to high-frequency words. Repeat key phrases. Avoid idioms.",
  A2: "Use simple sentences (5–10 words). Common everyday vocabulary. Light use of basic connectors.",
  B1: "Use natural conversational sentences (8–14 words). Common idioms allowed. Ask follow-up questions.",
  B2: "Speak naturally with mid-length sentences. Use idioms freely. Challenge the learner gently.",
  C1: "Speak as you would to another native. Use rich vocabulary, idioms, cultural references.",
  C2: "Fully native register. Nuanced phrasing, jokes, regional flavour.",
};

function buildTutorExtras(dialect: Dialect, cefr: string, topicHint?: string) {
  const level = (cefr || "A2").toUpperCase();
  const levelRule = LEVEL_GUIDANCE[level] ?? LEVEL_GUIDANCE.A2;

  return `You are an ACTIVE TUTOR having a free-flowing conversation with a learner whose CEFR level is ${level}.
${levelRule}

CONVERSATION RULES:
1. Reply ONLY in Arabic (${getDialectLabel(dialect)}). Do NOT include English translations or transliteration in your reply text — the UI handles those.
2. Keep replies SHORT and natural — 1 to 3 sentences. This is a chat, not a monologue.
3. ALWAYS end with a question or conversational hook so the learner keeps talking.
4. Stay in dialect — never switch to MSA (فصحى).
5. Sound like a real friend chatting, not a textbook.

CORRECTION RULES (very important):
- If the learner's last message has a clear grammar/vocabulary mistake or used the wrong dialect/MSA, prepend a single line in this EXACT format on its own first line, then a blank line, then your normal Arabic reply:
  [[CORRECTION]] short friendly fix in English (one sentence, ≤ 20 words)
- Only correct genuinely wrong things. Do NOT correct stylistic choices or correct every message.
- If nothing to correct, do NOT include any [[CORRECTION]] line.

${topicHint ? `OPENING TOPIC HINT: The learner picked the topic "${topicHint}" — open the conversation naturally around that subject.` : "OPENING: Start with a warm friendly greeting and ask an open question to get to know the learner."}`;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "free-chat", 30, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { messages, dialect, cefrLevel, topicHint } = await req.json() as {
      messages: ChatMessage[];
      dialect?: Dialect;
      cefrLevel?: string;
      topicHint?: string;
    };

    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const effectiveDialect = (dialect ?? "Gulf") as Dialect;

    // Multi-turn drift tracking: scan the last 3 assistant turns for MSA leaks.
    // If found, append a self-correction nudge so the model stops repeating the pattern.
    const recentAssistantTurns = messages
      .filter((m) => m.role === "assistant")
      .slice(-3)
      .map((m) => m.content)
      .join("\n");
    const historyLeaks = recentAssistantTurns
      ? detectMsaLeaks(recentAssistantTurns, effectiveDialect).leaks
      : [];
    const driftNudge = historyLeaks.length > 0
      ? `\n\nSELF-CORRECTION (your earlier replies used MSA tokens: ${historyLeaks.slice(0, 8).join(", ")}). Do NOT repeat that pattern — use only ${getDialectLabel(effectiveDialect)} forms from here on.`
      : "";

    return await streamBrain({
      purpose: "free_chat_turn",
      dialect: effectiveDialect,
      systemPromptExtra: buildTutorExtras(effectiveDialect, cefrLevel ?? "A2", topicHint) + driftNudge,
      messages,
      model: "google/gemini-2.5-pro",
      temperature: 0.7,
      responseHeaders: corsHeaders,
      signal: req.signal,
    });
  } catch (e) {
    if (e instanceof BrainHttpError) {
      if (e.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (e.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("free-chat brain error:", e.status, e.message);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("free-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
