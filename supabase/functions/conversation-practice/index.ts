// conversation-practice — an ENGLISH conversation partner for Arabic
// speakers, through the Brain's english-target mode. The Brain owns the
// English identity + interference rulebook; this file appends difficulty
// guidance, scans the learner's recent turns for known Arabic-transfer
// phrases so the partner corrects them by name, and buffers the stream
// server-side because the client expects { reply }.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { streamBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { getTransferPatterns } from "../_shared/englishHelpers.ts";
import { detectTransferErrors } from "../_shared/transferErrorDetector.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


function difficultyExtras(difficulty: string): string {
  if (difficulty === "advanced") {
    return "Student English level: advanced. Speak naturally at full speed. Use complex grammar, idioms, and cultural expressions. Challenge the student.";
  }
  if (difficulty === "intermediate") {
    return "Student English level: intermediate. Use moderately complex sentences. Mix common and less common vocabulary. Correct mistakes gently.";
  }
  return "Student English level: beginner. Use very simple, short sentences. Use only basic vocabulary. Be encouraging and patient.";
}

async function readSseToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const out: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string") out.push(delta);
        } catch { /* skip partial chunk */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return out.join("");
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cap = await enforceDailyCap(req, "conversation-practice", 50, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { messages, dialect = "Gulf", difficulty = "beginner" } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    // Transfer-error tracking: scan the learner's recent turns for known
    // Arabic-shaped English (the mirror of the old assistant-side MSA drift
    // nudge — here the drift worth catching is the learner's, and the
    // partner is told to correct it by name rather than let it slide).
    const effectiveDialect = dialect as Dialect;
    const recentLearnerTurns = (messages as Array<{ role: string; content: string }>)
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) => m.content)
      .join("\n");
    const transferHits = recentLearnerTurns
      ? detectTransferErrors(recentLearnerTurns, getTransferPatterns(effectiveDialect)).errors
      : [];
    const driftNudge = transferHits.length > 0
      ? `\n\nThe student's recent messages contain known Arabic-transfer phrases: ${
          transferHits.slice(0, 5).map((e) => `"${e.match}"${e.suggestion ? ` (say: "${e.suggestion}")` : ""}`).join(", ")
        }. Weave a gentle correction into your reply — name the natural form; a short ${getDialectLabel(effectiveDialect)} aside explaining why is welcome.`
      : "";

    // A conversation partner who knows your vocabulary can stay inside it and
    // stretch just past it — the difference between practice and a wall of text.
    // Only the first turn pays the query: on later turns the same profile is
    // already reflected in the history the model can see.
    const learnerBlock = messages.length <= 2
      ? await learnerPromptBlock({ userId: cap.userId, dialect: effectiveDialect, target: "english" })
      : "";
    const learnerNudge = learnerBlock ? `\n\n${learnerBlock}` : "";

    try {
      const streamed = await streamBrain({
        purpose: "conversation_practice_turn",
        dialect: effectiveDialect,
        target: "english",
        systemPromptExtra:
          `You are a friendly English conversation partner. Keep the conversation going naturally — ask follow-ups, react, share. ` +
          difficultyExtras(difficulty) + driftNudge + learnerNudge,
        messages,
        model: MODEL_IDS.GEMINI_FAST,
        temperature: 0.8,
        maxTokens: 500,
        signal: controller.signal,
      });

      if (!streamed.body) {
        return new Response(
          JSON.stringify({ error: "AI service unavailable" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const reply = await readSseToText(streamed.body);

      if (!reply) {
        return new Response(
          JSON.stringify({ error: "AI service unavailable" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ reply }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    if (e instanceof BrainHttpError) {
      if (e.status === 402) {
        return new Response(
          JSON.stringify({ error: "Not enough AI credits. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (e.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.error("conversation-practice brain error:", e.status, e.message);
      return new Response(
        JSON.stringify({ error: `AI service error (${e.status})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    console.error("conversation-practice error:", message);
    return new Response(
      JSON.stringify({ error: isAbort ? "Request timed out. Please try again." : message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
