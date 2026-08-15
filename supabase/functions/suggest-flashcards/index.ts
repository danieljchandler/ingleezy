import { getCorsHeaders } from "../_shared/cors.ts";


const DIALECT_GUIDE: Record<string, string> = {
  Gulf: "Gulf Arabic (Khaleeji) — as spoken in UAE, Saudi, Kuwait, Qatar, Bahrain, Oman. Use Khaleeji vocabulary and forms (e.g. شلونك, وايد, زين). Do NOT use MSA or Egyptian.",
  Egyptian: "Egyptian Arabic (Masri) — as spoken in Cairo. Use Egyptian vocabulary and forms (e.g. ازيك, اوي, كويس). Do NOT use MSA, Gulf, or Levantine.",
  Yemeni: "Yemeni Arabic — as spoken in Sana'a/Yemen. Use authentic Yemeni vocabulary and forms. Do NOT use MSA, Gulf, or Egyptian.",
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { topic, dialect = "Gulf", existingWords = [], count = 10 } = await req.json();
    if (!topic || typeof topic !== "string") {
      return new Response(JSON.stringify({ error: "topic is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const dialectGuide = DIALECT_GUIDE[dialect] ?? DIALECT_GUIDE.Gulf;
    const existingList = (existingWords as string[]).slice(0, 500);

    const systemPrompt = `You are an expert Arabic vocabulary tutor.
DIALECT: ${dialect}. ${dialectGuide}
Generate exactly ${count} useful, distinct vocabulary words/short phrases related to the user's topic.
RULES:
- Use the dialect specified above. Never MSA. Never another dialect.
- Each entry must be a single word or short common phrase (max 3 words).
- Provide concise English translation.
- Do NOT include any of the words the user already has saved (case-insensitive, ignore diacritics).
- Avoid duplicates within your own list.
- Mix difficulty: include some everyday essentials and some less common but useful items on the topic.`;

    const userPrompt = `Topic / guidance: ${topic}

Words the user already has saved (DO NOT repeat any of these):
${existingList.length ? existingList.join(", ") : "(none)"}

Generate ${count} new flashcards.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_flashcards",
              description: "Return the generated flashcards.",
              parameters: {
                type: "object",
                properties: {
                  flashcards: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        word_arabic: { type: "string", description: "The word/phrase in the target dialect (Arabic script, no diacritics required)" },
                        word_english: { type: "string", description: "Concise English translation" },
                        transliteration: { type: "string", description: "Optional Latin-script transliteration" },
                        // Costs a handful of output tokens on a call that is
                        // already being made, and saves the word from the
                        // family backfill later. Optional: an invented family
                        // is worse than none, since a false family is what the
                        // whole feature has to avoid. The family belongs to
                        // word_english — `enrich-word-roots` and `familyKey`
                        // both derive it from the English, not from the gloss.
                        word_family: { type: "string", description: 'Base form of the English word family (e.g. "act" for action/active/actor), or "" if the word has none' },
                        example_arabic: { type: "string", description: "Optional short example sentence in the dialect" },
                        example_english: { type: "string", description: "English translation of the example" },
                      },
                      required: ["word_arabic", "word_english"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["flashcards"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_flashcards" } },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("AI gateway error", response.status, text);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall?.function?.arguments;
    const parsed = args ? JSON.parse(args) : { flashcards: [] };

    // Final dedupe against existing list
    const existingNorm = new Set(existingList.map((w) => normalize(w)));
    const flashcards = (parsed.flashcards || []).filter(
      (c: any) => c?.word_arabic && !existingNorm.has(normalize(c.word_arabic))
    );

    return new Response(JSON.stringify({ flashcards }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-flashcards error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "") // strip Arabic diacritics
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim()
    .toLowerCase();
}
