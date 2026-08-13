// culture-guide — streams a grounded answer from Gemini using Google Search
// grounding. We call Gemini's native streaming endpoint with GEMINI_API_KEY
// (this bypasses the Lovable gateway because googleSearch isn't an
// OpenAI-compatible tool), and re-emit each text chunk in OpenAI SSE shape so
// the existing client parser keeps working. After the model finishes we
// append a "Sources" markdown block built from groundingMetadata.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectIdentity, getDialectVocabRules, getDialectLabel } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const GROUNDED_MODEL = "gemini-2.5-flash";

function buildSystemPrompt(dialect: string): string {
  const dialectLabel = getDialectLabel(dialect);
  const identity = getDialectIdentity(dialect);
  const vocabRules = getDialectVocabRules(dialect);

  const regionDesc = dialect === 'Egyptian'
    ? 'Egyptian Arabic (مصري) — focused on Egyptian culture (Cairo, Alexandria, Upper Egypt, Delta region).'
    : dialect === 'Yemeni'
    ? "Yemeni Arabic (يمني) — focused on Yemeni culture (Sana'a, Aden, Hadramaut, Ta'izz, Marib)."
    : 'Gulf Arabic (Saudi, Emirati, Kuwaiti, Qatari, Bahraini, Omani culture).';

  const regionGuidelines = dialect === 'Egyptian'
    ? `- Provide the Egyptian Arabic phrase/response in Arabic script and English translation only
- NEVER include transliteration (no Latin-letter pronunciation guides)
- Explain the cultural reasoning behind your advice
- Mention if customs vary between regions of Egypt
- Cover greetings, hospitality, business etiquette, religious customs, family dynamics, social norms`
    : dialect === 'Yemeni'
    ? `- Provide the Yemeni Arabic phrase/response in Arabic script and English translation only
- NEVER include transliteration
- Explain the cultural reasoning behind your advice
- Mention if customs vary between regions of Yemen
- Cover greetings, hospitality, qat sessions, مفرج etiquette, جنبية traditions, business etiquette, religious customs, family dynamics, social norms`
    : `- Provide the Gulf Arabic phrase/response in Arabic script and English translation only
- NEVER include transliteration
- Explain the cultural reasoning behind your advice
- Mention if customs vary between Gulf countries
- Cover greetings, hospitality, business etiquette, religious customs, family dynamics, social norms`;

  return `${identity}

You are a ${dialectLabel} cultural advisor for "Hakiya" — ${regionDesc}

Your role: Help users navigate real-life social situations with culturally appropriate responses, phrases, and etiquette.

${vocabRules}

Guidelines:
${regionGuidelines}
- Use Google Search to ground time-sensitive or specific cultural questions in real, citable sources.
- If religious or sensitive, be respectful and factual.
- If you're not confident, say so clearly.
- Keep responses warm, practical, and conversational.
- Respond in English or Arabic depending on which language the user writes in.

If the question is completely unrelated to Arabic culture, politely redirect them.`;
}

// Convert chat-style messages to Gemini "contents" array.
function toGeminiContents(messages: Array<{ role: string; content: string }>) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

function openaiChunk(text: string): string {
  const payload = {
    choices: [{ delta: { content: text }, index: 0 }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function formatSources(metadata: any): string {
  const chunks: any[] = metadata?.groundingChunks ?? [];
  if (!chunks.length) return "";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of chunks) {
    const web = c?.web;
    if (!web?.uri) continue;
    if (seen.has(web.uri)) continue;
    seen.add(web.uri);
    const title = (web.title || web.uri).replace(/[\[\]]/g, "");
    lines.push(`- [${title}](${web.uri})`);
    if (lines.length >= 6) break;
  }
  if (!lines.length) return "";
  return `\n\n---\n**Sources**\n${lines.join("\n")}`;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "culture-guide", 15, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { messages, dialect = "Gulf" } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const systemPrompt = buildSystemPrompt(dialect);

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GROUNDED_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: toGeminiContents(messages),
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.7 },
        }),
      },
    );

    if (!upstream.ok) {
      const txt = await upstream.text();
      console.error("[culture-guide] upstream", upstream.status, txt);
      if (upstream.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: "AI service error", details: txt }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!upstream.body) throw new Error("No upstream body");

    // Transform Gemini SSE → OpenAI-shaped SSE chunks the existing client parses.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let lastGroundingMetadata: any = null;

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
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
                const cand = json.candidates?.[0];
                const parts = cand?.content?.parts ?? [];
                for (const p of parts) {
                  if (typeof p?.text === "string" && p.text.length) {
                    controller.enqueue(encoder.encode(openaiChunk(p.text)));
                  }
                }
                if (cand?.groundingMetadata) {
                  lastGroundingMetadata = cand.groundingMetadata;
                }
              } catch (e) {
                console.warn("[culture-guide] parse skip", e);
              }
            }
          }
          const sourcesMd = formatSources(lastGroundingMetadata);
          if (sourcesMd) controller.enqueue(encoder.encode(openaiChunk(sourcesMd)));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (e) {
          console.error("[culture-guide] stream err", e);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("culture-guide error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
