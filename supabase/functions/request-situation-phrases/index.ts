/**
 * request-situation-phrases
 *
 * User-facing. Given a free-form situation/context the learner needs phrases for,
 * generate 5-8 authentic dialect phrases via Lovable AI. Returns the phrases for
 * the client to display + selectively save into user_phrases.
 *
 * Body: { situation: string, dialect: string, count?: number }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


const DIALECT_RULES: Record<string, string> = {
  Gulf: "Authentic Gulf (Khaliji) Arabic only. Forbid MSA / Egyptian / Levantine / Yemeni. Use شلونك، وين، هالحين، يبي.",
  Egyptian: "Authentic Egyptian Arabic only. Forbid MSA / Gulf / Levantine / Yemeni. Use إزيك، فين، دلوقتي، عايز.",
  Yemeni: "Authentic Yemeni Arabic only. Forbid MSA / Gulf / Egyptian / Levantine. Use كيفك، وين، ذحين، بغيت.",
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { situation, dialect = "Gulf", count = 6 } = await req.json();
    if (!situation || typeof situation !== "string" || situation.trim().length < 3) {
      return new Response(JSON.stringify({ error: "situation required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "auth_required", message: "Please sign in to use this feature." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "config_missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const n = Math.max(3, Math.min(10, Number(count) || 6));
    const sys = `You generate authentic situational Arabic phrases for language learners.
${DIALECT_RULES[dialect] ?? DIALECT_RULES.Gulf}
Rules:
- Generate ${n} REAL phrases a native speaker would actually say in the described situation.
- Mix difficulty A1-B2; mix formality where appropriate.
- Include accurate English meaning and a Latin-script transliteration.
- Also include a "literal" word-for-word English gloss preserving the Arabic word order (may sound stiff; shows how the phrase is built).
- Add a short note ONLY if cultural/usage context matters; otherwise leave empty.
- NEVER invent unnatural phrases. NEVER use MSA when a dialect form exists.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Dialect: ${dialect}\nSituation: ${situation.trim()}\nGenerate ${n} phrases.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "emit_phrases",
            description: "Return situational phrases.",
            parameters: {
              type: "object",
              properties: {
                phrases: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      phrase_arabic: { type: "string" },
                      phrase_english: { type: "string" },
                      literal: { type: "string", description: "Word-for-word English gloss preserving Arabic word order." },
                      transliteration: { type: "string" },
                      notes: { type: "string" },
                    },
                    required: ["phrase_arabic", "phrase_english", "transliteration"],
                  },
                },
              },
              required: ["phrases"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "emit_phrases" } },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limit", message: "Too many requests, try again shortly." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "credits_exhausted", message: "AI credits exhausted." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`AI ${resp.status}: ${t.slice(0, 200)}`);
    }

    const data = await resp.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("no tool_call returned");
    const parsed = JSON.parse(args);
    const phrases = (parsed.phrases ?? []).map((p: any) => ({
      phrase_arabic: String(p.phrase_arabic ?? "").trim(),
      phrase_english: String(p.phrase_english ?? "").trim(),
      literal: String(p.literal ?? "").trim(),
      transliteration: String(p.transliteration ?? "").trim(),
      notes: p.notes ? String(p.notes).trim() : "",
    })).filter((p: any) => p.phrase_arabic && p.phrase_english);

    return new Response(JSON.stringify({ phrases, dialect, situation }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("request-situation-phrases error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
