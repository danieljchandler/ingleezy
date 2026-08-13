import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/errorResponse.ts";
import { getDialectTransliterationRules, type Dialect } from "../_shared/dialectHelpers.ts";

interface PhraseOut {
  phrase_arabic: string;
  phrase_english: string;
  transliteration: string;
  notes: string;
}

// Broad topic wheel — the AI is nudged into one of these buckets per request so
// the daily phrase actually varies instead of collapsing to safe greetings.
// Most situations are dialect-neutral (SHARED_CATEGORIES); a few are tied to a
// specific culture's daily life and get a per-dialect variant instead of a
// one-size-fits-all Gulf framing (majlis coffee culture, desert/mall weekends,
// shisha hangouts don't describe Egyptian or Yemeni daily life). Mirrors the
// SHARED_TOPICS / per-dialect split in src/data/listenTopics.ts.
const SHARED_CATEGORIES: { key: string; prompt: string }[] = [
  { key: "haggling", prompt: "haggling in the souq (asking for a discount, walking away, playful bargaining)" },
  { key: "traffic", prompt: "driving and traffic frustration (tailgaters, parking chaos, bad drivers)" },
  { key: "weather_hot", prompt: "complaining about the heat / humidity / dust" },
  { key: "family_teasing", prompt: "playful family teasing between siblings or cousins" },
  { key: "work_complaints", prompt: "office/work complaints (boss, meetings, deadlines) in a casual register" },
  { key: "food_praise", prompt: "praising or reacting to food (something delicious, too spicy, over-salted)" },
  { key: "hospitality_insist", prompt: "insisting a guest eat/stay more (classic Arab hospitality push-and-pull)" },
  { key: "surprise", prompt: "expressing genuine surprise or disbelief (no way, seriously, I can't believe it)" },
  { key: "doubt_sarcasm", prompt: "sarcasm or gentle doubt (yeah right, sure buddy, we'll see)" },
  { key: "encouragement", prompt: "encouraging someone before a challenge (you got this, don't be scared)" },
  { key: "apology_soft", prompt: "a soft apology or making up after a small argument" },
  { key: "compliment_looks", prompt: "complimenting someone's appearance or new outfit without being creepy" },
  { key: "kids_scolding", prompt: "a parent gently scolding or bargaining with a small child" },
  { key: "gossip", prompt: "leaning in to share a piece of gossip" },
  { key: "dua_wellwish", prompt: "a heartfelt dua or well-wish for a friend (health, exam, travel)" },
  { key: "idiom_animal", prompt: "an idiomatic expression involving an animal, body part, or food" },
  { key: "proverb", prompt: "a short well-known dialect proverb with real cultural weight" },
  { key: "money_broke", prompt: "joking about being broke at the end of the month" },
  { key: "phone_tech", prompt: "phone / wifi / app frustration (battery dying, no signal, laggy)" },
  { key: "tired_sleep", prompt: "being exhausted or begging for more sleep" },
  { key: "directions", prompt: "giving casual directions or landmarks (turn after the mosque, next to the corner shop)" },
  { key: "sports_banter", prompt: "football/sports banter between fans of rival teams" },
  { key: "shopping_indecision", prompt: "indecision while shopping (can't pick between two options)" },
  { key: "refuse_polite", prompt: "politely refusing an invitation without offending" },
  { key: "gratitude_deep", prompt: "expressing deep gratitude beyond the standard thank-you" },
  { key: "market_produce", prompt: "buying fresh produce, fish, or meat at the market" },
  { key: "prayer_mosque", prompt: "quick exchange around prayer time or at the mosque" },
];

const DIALECT_CATEGORIES: Record<string, { key: string; prompt: string }[]> = {
  Gulf: [
    { key: "coffee_majlis", prompt: "coffee/tea and sit-down hosting small talk in a majlis (pouring, refusing a third cup, complimenting the host)" },
    { key: "weekend_plans", prompt: "weekend plans with friends (beach, desert, mall, farm)" },
    { key: "invite_hangout", prompt: "casually inviting someone to hang out or grab shisha/coffee" },
  ],
  Egyptian: [
    { key: "coffee_majlis", prompt: "hanging out at an ahwa (coffeehouse) over tea, shisha, and backgammon/dominoes with the guys" },
    { key: "weekend_plans", prompt: "weekend plans with friends (Nile-side walk/felucca, club, mall, family lunch)" },
    { key: "invite_hangout", prompt: "casually inviting someone to the ahwa for tea or shisha" },
  ],
  Yemeni: [
    { key: "coffee_majlis", prompt: "an afternoon qat chew (maqyal) with friends — settling in, passing the bag, easy conversation" },
    { key: "weekend_plans", prompt: "weekend plans with friends or family (visiting relatives, a qat session, a trip to the old souq)" },
    { key: "invite_hangout", prompt: "casually inviting someone to a qat session or for tea at the mafraj (sitting room)" },
  ],
};

function categoriesFor(dialect: string): { key: string; prompt: string }[] {
  return [...SHARED_CATEGORIES, ...(DIALECT_CATEGORIES[dialect] ?? DIALECT_CATEGORIES.Gulf)];
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pickCategory(dialect: string, date: string, override?: string) {
  const categories = categoriesFor(dialect);
  if (override) {
    const found = categories.find((c) => c.key === override);
    if (found) return found;
  }
  const idx = hashString(`${dialect}|${date}`) % categories.length;
  return categories[idx];
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  try {
    const { dialect = "Gulf", seed, category: categoryOverride, avoidCategories } = await req
      .json()
      .catch(() => ({}));
    const today = seed || new Date().toISOString().slice(0, 10);

    // Skip categories the client already saw this session (from Refresh presses).
    let category = pickCategory(dialect, today, categoryOverride);
    if (Array.isArray(avoidCategories) && avoidCategories.length && !categoryOverride) {
      const remaining = categoriesFor(dialect).filter((c) => !avoidCategories.includes(c.key));
      if (remaining.length) {
        const idx = hashString(`${dialect}|${today}|${avoidCategories.length}`) % remaining.length;
        category = remaining[idx];
      }
    }

    // Recent-phrase avoid list — pull the last ~30 phrase-of-the-day outputs
    // for this dialect so the model doesn't repeat itself.
    let avoidBlock = "";
    try {
      const svc = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: recent } = await svc
        .from("user_phrases")
        .select("phrase_arabic, phrase_english")
        .eq("source", "phrase-of-the-day")
        .eq("dialect", dialect)
        .order("created_at", { ascending: false })
        .limit(30);
      const rows = (recent ?? []) as { phrase_arabic: string; phrase_english: string }[];
      if (rows.length) {
        const list = rows
          .map((r, i) => `${i + 1}. ${r.phrase_arabic} — ${r.phrase_english}`)
          .join("\n");
        avoidBlock = `\n\nDO NOT repeat, translate, or lightly paraphrase any of these recently-used phrases:\n${list}\n`;
      }
    } catch (e) {
      console.warn("[phrase-of-the-day] avoid-list fetch failed", (e as Error).message);
    }

    const userPrompt = `Generate today's Phrase of the Day.

Today's category: **${category.prompt}**
Seed: ${today}-${category.key}

Hard requirements:
- The phrase must clearly fit the category above. If the category is not about greetings, DO NOT produce a greeting or a polite pleasantry.
- 4 to 10 words. A real sentence or idiomatic expression, not a single word or a textbook line.
- Must sound like something a native ${dialect} speaker would actually say to a friend today — colloquial, natural, dialect-authentic.
- Avoid the most obvious tourist-phrasebook lines (hello, how are you, thank you, my name is, where is the bathroom, etc.) unless the category explicitly calls for them.
- Include a short cultural or usage note (1–2 sentences) explaining when/why a native speaker would use it.${avoidBlock}`;

    const result = await askBrain<PhraseOut>({
      purpose: "phrase_of_the_day",
      dialect,
      userPrompt,
      systemPromptExtra: getDialectTransliterationRules(dialect as Dialect),
      strategy: "solo",
      maxTokens: 700,
      temperature: 1.0,
      tool: {
        name: "return_phrase",
        description: "Return the phrase of the day with translation and notes",
        parameters: {
          type: "object",
          properties: {
            phrase_arabic: { type: "string", description: "The phrase in Arabic script (dialect)" },
            phrase_english: { type: "string", description: "Natural English translation" },
            transliteration: { type: "string", description: "Romanized pronunciation" },
            notes: { type: "string", description: "Brief cultural or usage note (1-2 sentences)" },
          },
          required: ["phrase_arabic", "phrase_english", "transliteration", "notes"],
          additionalProperties: false,
        },
      },
      arabicTextPath: (p) => (p as PhraseOut).phrase_arabic,
    });

    return new Response(
      JSON.stringify({
        ...result.output,
        dialect,
        date: today,
        category: category.key,
        _meta: {
          strategy: result.strategy,
          models: result.models,
          msaRepairs: result.msaRepairs,
          category: category.key,
        },
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("phrase-of-the-day error:", err);
    if (err instanceof BrainHttpError) {
      // Return 200 with a fallback signal so the client renders gracefully
      // instead of showing a blank screen / runtime error.
      if (err.status === 402) {
        return new Response(
          JSON.stringify({
            error: "ai_credits_exhausted",
            fallback: true,
            message: "AI credits exhausted. Please add credits to continue generating fresh phrases.",
          }),
          { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      if (err.status === 429) {
        return new Response(
          JSON.stringify({
            error: "rate_limited",
            fallback: true,
            message: "Rate limit exceeded, try again shortly.",
          }),
          { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
    }
    return createErrorResponse(
      500,
      err instanceof Error ? err.message : "Unknown error",
      cors,
    );
  }
});
