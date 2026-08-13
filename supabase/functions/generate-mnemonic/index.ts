import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { arabic, english, transliteration, dialect = "Gulf", kind = "word" } =
      await req.json();

    if (!arabic || !english) {
      return new Response(
        JSON.stringify({ error: "arabic and english are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = `You are a memory coach helping English speakers memorize ${dialect} Arabic ${kind}s they keep forgetting.

Produce ONE short English mnemonic (max 2 sentences, ~35 words) that uses a sound-alike / vivid image / story link technique to tie the Arabic pronunciation to the English meaning.

Rules:
- Anchor on the SOUND of the Arabic, not its spelling
- Paint a vivid, slightly absurd image — absurd images stick
- The image must clearly evoke the English meaning
- Plain English only. Do NOT transliterate the Arabic again; do NOT add headers, labels, bullets, quotes, or "Mnemonic:" prefix
- Output the mnemonic sentence(s) and nothing else`;

    const userPrompt = `Arabic ${kind}: ${arabic}
English: ${english}${transliteration ? `\nPronounced roughly: ${transliteration}` : ""}
Dialect: ${dialect}

Write the mnemonic.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) {
      const status = resp.status;
      if (status === 429 || status === 402) {
        return new Response(
          JSON.stringify({
            error: status === 429 ? "Rate limited, try again later" : "AI credits exhausted",
          }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await resp.text();
      console.error("Mnemonic gen error:", status, errText);
      return new Response(
        JSON.stringify({ error: "Failed to generate mnemonic" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    const mnemonic = (data.choices?.[0]?.message?.content ?? "").trim();

    if (!mnemonic) {
      return new Response(
        JSON.stringify({ error: "Empty mnemonic" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ mnemonic }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-mnemonic error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
