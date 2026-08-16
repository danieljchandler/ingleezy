// Topic-driven flashcard suggestions: the learner names a subject and gets
// back words they don't already have.
//
// Post-flip the words are ENGLISH with a dialect gloss, not the other way
// round. The direction is not cosmetic here — it decides which half the
// deduplication compares, and comparing the wrong half means the learner is
// offered words they already own whenever two English words share a gloss.
import { getCorsHeaders } from "../_shared/cors.ts";


// The dialect the GLOSS is written in. The words themselves are English; this
// picks the Arabic a learner from that region would actually use to explain
// them to themselves.
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

    const systemPrompt = `You are an expert English vocabulary tutor. Your learners are native Arabic speakers.
GLOSS DIALECT: ${dialect}. ${dialectGuide}
Generate exactly ${count} useful, distinct ENGLISH words/short phrases related to the user's topic.
RULES:
- The word being learned is the ENGLISH one. The Arabic is its gloss, written in the dialect specified above — never MSA, never another dialect.
- Each entry must be a single word or short common phrase (max 3 words).
- Natural spoken English, the register a person would actually meet the word in. Not textbook English.
- Do NOT include any of the English words the user already has saved (case-insensitive).
- Avoid duplicates within your own list, including two words that a learner would file as the same word (walk/walking).
- Mix difficulty: include some everyday essentials and some less common but useful items on the topic.`;

    const userPrompt = `Topic / guidance: ${topic}

English words the user already has saved (DO NOT repeat any of these):
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
                        word_english: { type: "string", description: "The English word/phrase being learned" },
                        word_arabic: { type: "string", description: "Its gloss in the dialect specified above (Arabic script, no diacritics required)" },
                        // The learner reads Arabic, so the pronunciation aid is
                        // the English respelled in Arabic letters — the same
                        // phonetic_ar the phrase surfaces use. A Latin
                        // transliteration would be a third script to decode.
                        phonetic_ar: { type: "string", description: 'The English pronounced in Arabic letters (e.g. "ثانك يو" for "thank you")' },
                        // Costs a handful of output tokens on a call that is
                        // already being made, and saves the word from the
                        // family backfill later. Optional: an invented family
                        // is worse than none, since a false family is what the
                        // whole feature has to avoid. The family belongs to
                        // word_english — `enrich-word-roots` and `familyKey`
                        // both derive it from the English, not from the gloss.
                        word_family: { type: "string", description: 'Base form of the English word family (e.g. "act" for action/active/actor), or "" if the word has none' },
                        example_english: { type: "string", description: "Optional short example sentence in natural spoken English using the word" },
                        example_arabic: { type: "string", description: "Dialect gloss of the example sentence" },
                      },
                      required: ["word_english", "word_arabic"],
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

    // Final dedupe against the learner's existing ENGLISH headwords. The prompt
    // already asks for this and the model already ignores it sometimes; prompts
    // are advice, the filter is the guarantee. Compared on the English because
    // that is the card's identity — matching on the gloss would drop "large"
    // for a learner who already has "big", since both gloss to كبير.
    const existingNorm = new Set(existingList.map((w) => normalize(w)));
    const flashcards = (parsed.flashcards || []).filter(
      (c: any) => c?.word_english && !existingNorm.has(normalize(c.word_english))
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

/**
 * Fold an English headword to the form two spellings of the same word share.
 *
 * The Arabic version of this folded orthographic variation — ta marbuta for
 * ha, the alif family, dropped diacritics — because Arabic writes one word
 * several ways. English writes one word one way, and its near-duplicates are
 * punctuation and spacing instead: "check-in" against "check in", a trailing
 * period, "  Airport  ". Same job, different alphabet.
 */
function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
