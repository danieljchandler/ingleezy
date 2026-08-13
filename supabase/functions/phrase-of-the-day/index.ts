// Phrase of the day, flipped: a real spoken-English expression a native would
// say today, glossed in the learner's dialect, with a phonetic_ar rendering
// and a usage note in their own Arabic.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/errorResponse.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";

interface PhraseOut {
  phrase_english: string;
  phrase_arabic: string;
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
  { key: "haggling", prompt: "asking for a discount or a better deal (is that your best price, any chance of a deal)" },
  { key: "traffic", prompt: "driving and traffic frustration (tailgaters, parking chaos, bad drivers)" },
  { key: "weather_small_talk", prompt: "small talk about the weather (the classic English conversation opener)" },
  { key: "family_teasing", prompt: "playful family teasing between siblings or cousins" },
  { key: "work_complaints", prompt: "office/work complaints (boss, meetings, deadlines) in a casual register" },
  { key: "food_praise", prompt: "praising or reacting to food (something delicious, too spicy, over-salted)" },
  { key: "hospitality_insist", prompt: "insisting a guest eat/stay more (go on, have another, I won't take no for an answer)" },
  { key: "surprise", prompt: "expressing genuine surprise or disbelief (no way, seriously, I can't believe it)" },
  { key: "doubt_sarcasm", prompt: "sarcasm or gentle doubt (yeah right, sure buddy, we'll see)" },
  { key: "encouragement", prompt: "encouraging someone before a challenge (you got this, don't be scared)" },
  { key: "apology_soft", prompt: "a soft apology or making up after a small argument" },
  { key: "compliment_looks", prompt: "complimenting someone's appearance or new outfit without being creepy" },
  { key: "kids_scolding", prompt: "a parent gently scolding or bargaining with a small child" },
  { key: "gossip", prompt: "leaning in to share a piece of gossip (you didn't hear it from me...)" },
  { key: "wellwish", prompt: "a heartfelt well-wish for a friend (health, exam, travel, new job)" },
  { key: "idiom_animal", prompt: "an idiomatic English expression involving an animal, body part, or food" },
  { key: "proverb", prompt: "a short well-known English saying with real cultural weight" },
  { key: "money_broke", prompt: "joking about being broke at the end of the month" },
  { key: "phone_tech", prompt: "phone / wifi / app frustration (battery dying, no signal, laggy)" },
  { key: "tired_sleep", prompt: "being exhausted or begging for more sleep" },
  { key: "directions", prompt: "giving casual directions or landmarks (turn after the lights, next to the corner shop)" },
  { key: "sports_banter", prompt: "football/sports banter between fans of rival teams" },
  { key: "shopping_indecision", prompt: "indecision while shopping (can't pick between two options)" },
  { key: "refuse_polite", prompt: "politely refusing an invitation without offending" },
  { key: "gratitude_deep", prompt: "expressing deep gratitude beyond the standard thank-you" },
  { key: "coffee_order", prompt: "ordering at a coffee shop like a regular (the usual, to go, extra shot)" },
  { key: "weekend_plans", prompt: "weekend plans with friends (barbecue, match, cinema, day out)" },
  { key: "invite_hangout", prompt: "casually inviting someone to hang out or grab a coffee" },
  { key: "phone_call_open", prompt: "opening or wrapping up a phone call naturally (hey it's me, anyway I'll let you go)" },
];

function categoriesFor(_dialect: string): { key: string; prompt: string }[] {
  // The phrase is English for everyone; the dialect only names the gloss.
  return SHARED_CATEGORIES;
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
          .map((r, i) => `${i + 1}. ${r.phrase_english} — ${r.phrase_arabic}`)
          .join("\n");
        avoidBlock = `\n\nDO NOT repeat, translate, or lightly paraphrase any of these recently-used phrases:\n${list}\n`;
      }
    } catch (e) {
      console.warn("[phrase-of-the-day] avoid-list fetch failed", (e as Error).message);
    }

    const dialectLabel = getDialectLabel(dialect as Dialect);
    const userPrompt = `Generate today's English Phrase of the Day for a native ${dialectLabel} Arabic speaker learning English.

Today's category: **${category.prompt}**
Seed: ${today}-${category.key}

Hard requirements:
- The phrase must clearly fit the category above. If the category is not about greetings, DO NOT produce a greeting or a polite pleasantry.
- 4 to 10 words. A real spoken-English sentence or idiomatic expression, not a single word or a textbook line.
- Must sound like something a native English speaker would actually say to a friend today — colloquial, contractions welcome, natural.
- Avoid the most obvious phrasebook lines (hello, how are you, thank you, my name is, where is the bathroom, etc.) unless the category explicitly calls for them.
- phrase_arabic: a natural ${dialectLabel} gloss of the phrase (spoken dialect, never Fusha).
- transliteration: the ENGLISH pronounced in Arabic letters (e.g. "ثانك يو" for "thank you"), readable aloud immediately.
- notes: a short usage note (1–2 sentences) in the learner's ${dialectLabel} explaining when/why a native speaker says it.${avoidBlock}`;

    const result = await askBrain<PhraseOut>({
      purpose: "phrase_of_the_day",
      dialect,
      target: "english",
      userPrompt,
      strategy: "solo",
      maxTokens: 700,
      temperature: 1.0,
      tool: {
        name: "return_phrase",
        description: "Return the English phrase of the day with its dialect gloss and notes",
        parameters: {
          type: "object",
          properties: {
            phrase_english: { type: "string", description: "The English phrase — the thing being learned" },
            phrase_arabic: { type: "string", description: "Its dialect-Arabic gloss (never Fusha)" },
            transliteration: { type: "string", description: "The English pronounced in Arabic letters (phonetic_ar)" },
            notes: { type: "string", description: "Brief usage note (1-2 sentences) in the learner's dialect Arabic" },
          },
          required: ["phrase_english", "phrase_arabic", "transliteration", "notes"],
          additionalProperties: false,
        },
      },
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
