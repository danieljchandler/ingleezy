/**
 * seed-set-phrases
 *
 * Admin tool. Generates 10 draft phrases per occasion for the given dialect via
 * Lovable AI. Phrases are inserted as status='draft' for admin review.
 *
 * Body: { dialect: string, occasionIds?: string[] }
 * Requires admin user JWT.
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

async function generatePhrases(dialect: string, occasionName: string): Promise<any[]> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const sys = `You curate authentic Arabic situational-phrase libraries for language learners.
${DIALECT_RULES[dialect] ?? DIALECT_RULES.Gulf}
Rules:
- Generate 10 distinct REAL phrases native speakers actually say for the occasion. NO invented phrases.
- Mix difficulties A1-B2; mix formality (casual/neutral/formal/religious).
- CRITICAL: Every phrase MUST include the most common native reply (reply_arabic, reply_english, reply_transliteration). Set phrases are conversational — there is ALWAYS an expected response (greeting → return greeting, condolence → standard reply, congratulations → standard reply, thanks → standard reply, etc.). Never omit the reply. If multiple replies are common, pick the single most frequent one.
- The reply must be authentic to the same dialect as the phrase, NOT MSA.
- Provide a 1-sentence English scenario where someone would say the phrase.
- For BOTH the phrase and its reply, also provide a "literal" word-for-word English gloss (phrase_literal, reply_literal) that preserves the Arabic word order (e.g. "what news-your?" for "شخبارك؟"). It may sound stiff — it shows learners how the phrase is built.
- Cultural sensitivity: respectful tone for funerals/religious.`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_IDS.GEMINI_FAST,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Occasion: ${occasionName}\nDialect: ${dialect}\nGenerate 10 phrases.` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "emit_phrases",
          description: "Return 10 set phrases.",
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
                    phrase_literal: { type: "string", description: "Word-for-word English gloss of the phrase, preserving Arabic word order." },
                    phrase_transliteration: { type: "string" },
                    reply_arabic: { type: "string" },
                    reply_english: { type: "string" },
                    reply_literal: { type: "string", description: "Word-for-word English gloss of the reply, preserving Arabic word order." },
                    reply_transliteration: { type: "string" },
                    scenario_english: { type: "string" },
                    cultural_note: { type: "string" },
                    formality: { type: "string", enum: ["casual", "neutral", "formal", "religious"] },
                    difficulty: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1"] },
                  },
                  required: ["phrase_arabic", "phrase_english", "reply_arabic", "reply_english", "reply_transliteration", "scenario_english", "formality", "difficulty"],
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
  if (!resp.ok) throw new Error(`AI ${resp.status}: ${await resp.text().then((t) => t.slice(0, 200))}`);
  const data = await resp.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("no tool_call returned");
  return JSON.parse(args).phrases ?? [];
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { dialect = "Gulf", occasionIds } = await req.json();
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    if (!roles?.some((r: any) => r.role === "admin")) {
      return new Response(JSON.stringify({ error: "admin required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let occasionsQ = admin.from("set_phrase_occasions").select("id, name").eq("dialect", dialect);
    if (occasionIds && Array.isArray(occasionIds) && occasionIds.length) {
      occasionsQ = occasionsQ.in("id", occasionIds);
    }
    const { data: occasions } = await occasionsQ;
    if (!occasions?.length) {
      return new Response(JSON.stringify({ error: "no occasions found" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const summary: { occasion: string; inserted: number; error?: string }[] = [];
    for (const occ of occasions) {
      try {
        const phrases = await generatePhrases(dialect, occ.name);
        const rows = phrases.map((p) => ({
          occasion_id: occ.id,
          dialect,
          phrase_arabic: p.phrase_arabic,
          phrase_english: p.phrase_english ?? null,
          phrase_literal: p.phrase_literal ?? null,
          phrase_transliteration: p.phrase_transliteration ?? null,
          reply_arabic: p.reply_arabic ?? null,
          reply_english: p.reply_english ?? null,
          reply_literal: p.reply_literal ?? null,
          reply_transliteration: p.reply_transliteration ?? null,
          scenario_english: p.scenario_english ?? null,
          cultural_note: p.cultural_note ?? null,
          formality: p.formality ?? "neutral",
          difficulty: p.difficulty ?? "A1",
          status: "draft",
          created_by: user.id,
        }));
        const { error: insErr } = await admin.from("set_phrases").insert(rows);
        if (insErr) throw insErr;
        summary.push({ occasion: occ.name, inserted: rows.length });
        // small delay between occasions
        await new Promise((r) => setTimeout(r, 1500));
      } catch (e) {
        summary.push({ occasion: occ.name, inserted: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("seed-set-phrases error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
