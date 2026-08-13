/**
 * generate-set-phrase-quiz
 *
 * Builds a mixed practice session: due SRS phrases + new phrases. For each picked
 * phrase, randomly assigns a `reply` or `scenario` question type. If a scenario
 * question lacks cached distractors, calls Lovable AI to generate them.
 *
 * Body: { dialect: string, occasionId?: string, length?: number }
 * Auth: requires user JWT (uses anon key + auth header).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


const DIALECT_RULES: Record<string, string> = {
  Gulf: "Use authentic Gulf (Khaliji) Arabic only. Forbid MSA (فصحى) and Egyptian/Levantine/Yemeni. Use forms like شلونك، وين، هالحين، يبي.",
  Egyptian: "Use authentic Egyptian Arabic only. Forbid MSA and Gulf/Levantine/Yemeni. Use forms like إزيك، فين، دلوقتي، عايز.",
  Yemeni: "Use authentic Yemeni Arabic only. Forbid MSA and Gulf/Egyptian/Levantine. Use forms like كيفك، وين، ذحين، بغيت.",
};

interface QuizItem {
  phrase_id: string;
  question_type: "reply" | "scenario";
  prompt: { arabic?: string; english?: string; audio_url?: string | null };
  expected_arabic: string;
  expected_english?: string | null;
  expected_transliteration?: string | null;
  expected_audio_url?: string | null;
  cultural_note?: string | null;
  formality?: string | null;
  occasion?: { name: string; icon_name: string } | null;
  choices: { arabic: string; english?: string; correct: boolean }[];
  is_due_review: boolean;
}

async function generateScenarioAndDistractors(
  dialect: string,
  phraseArabic: string,
  phraseEnglish: string | null,
  occasion: string | null,
): Promise<{ scenario_english: string; distractors: { arabic: string; english: string }[] } | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;

  const sys = `You design culturally authentic Arabic situational-phrase quizzes.
${DIALECT_RULES[dialect] ?? DIALECT_RULES.Gulf}
Rules:
- The "correct" phrase is fixed and shown to you. NEVER invent or rewrite it.
- Generate ONE short English scenario (1-2 sentences) where a native speaker would naturally say the correct phrase.
- Generate exactly 3 distractor phrases that are REAL Arabic phrases used in OTHER situations (not nonsense, not synonyms of the correct one). They should sound plausible to a learner who only recognises individual words.
- For funerals, religious or sensitive occasions, keep tone respectful — no humor.`;

  const user = `Correct phrase: ${phraseArabic}${phraseEnglish ? ` (means: ${phraseEnglish})` : ""}
Occasion: ${occasion ?? "general"}
Generate the scenario + 3 distractor phrases.`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_scenario",
              description: "Return the scenario and 3 distractors.",
              parameters: {
                type: "object",
                properties: {
                  scenario_english: { type: "string" },
                  distractors: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        arabic: { type: "string" },
                        english: { type: "string" },
                      },
                      required: ["arabic", "english"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["scenario_english", "distractors"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_scenario" } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.error("AI gateway", resp.status, await resp.text().catch(() => ""));
      return null;
    }
    const data = await resp.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    const parsed = JSON.parse(args);
    const distractors = (parsed.distractors || []).slice(0, 3);
    if (distractors.length < 3) return null;
    return { scenario_english: parsed.scenario_english, distractors };
  } catch (err) {
    console.error("scenario gen failed:", err);
    return null;
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { dialect = "Gulf", occasionId, length = 8 } = await req.json();
    const authHeader = req.headers.get("Authorization") ?? "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();

    // 1. Due reviews (up to half)
    const halfLen = Math.floor(length / 2);
    const { data: dueRows } = await admin
      .from("user_set_phrases")
      .select("phrase_id, set_phrases!inner(*, set_phrase_occasions(name, icon_name))")
      .eq("user_id", user.id)
      .lte("next_review_at", now)
      .eq("set_phrases.dialect", dialect)
      .eq("set_phrases.status", "published")
      .order("next_review_at", { ascending: true })
      .limit(halfLen);

    const dueIds = new Set((dueRows ?? []).map((r: any) => r.phrase_id));

    // 2. New phrases to fill
    const remaining = length - (dueRows?.length ?? 0);
    let newQuery = admin
      .from("set_phrases")
      .select("*, set_phrase_occasions(name, icon_name)")
      .eq("dialect", dialect)
      .eq("status", "published");
    if (occasionId) newQuery = newQuery.eq("occasion_id", occasionId);
    const { data: candidates } = await newQuery.limit(60);

    const filtered = (candidates ?? []).filter((p: any) => !dueIds.has(p.id));
    const newPicks = shuffle(filtered).slice(0, Math.max(0, remaining));

    const all: { row: any; due: boolean }[] = [
      ...(dueRows ?? []).map((r: any) => ({ row: r.set_phrases, due: true })),
      ...newPicks.map((row: any) => ({ row, due: false })),
    ];

    const items: QuizItem[] = [];
    for (const { row: p, due } of all) {
      const hasReply = !!p.reply_arabic;
      const canScenario = true; // we can synthesize a scenario via AI
      const type: "reply" | "scenario" =
        hasReply && Math.random() < 0.5 ? "reply" : (canScenario ? "scenario" : "reply");

      let scenarioText: string | null = p.scenario_english || null;
      let distractors: { arabic: string; english?: string }[] = Array.isArray(p.cached_distractors)
        ? p.cached_distractors
        : [];

      if (type === "scenario" && (!scenarioText || distractors.length < 3)) {
        const gen = await generateScenarioAndDistractors(
          dialect,
          p.phrase_arabic,
          p.phrase_english,
          p.set_phrase_occasions?.name ?? null,
        );
        if (gen) {
          scenarioText = scenarioText || gen.scenario_english;
          if (distractors.length < 3) distractors = gen.distractors;
          // cache
          await admin
            .from("set_phrases")
            .update({
              scenario_english: scenarioText,
              cached_distractors: distractors,
            })
            .eq("id", p.id);
        }
      }

      const expected = type === "reply" ? p.reply_arabic : p.phrase_arabic;
      const expectedEng = type === "reply" ? p.reply_english : p.phrase_english;
      const expectedAudio = type === "reply" ? p.reply_audio_url : p.phrase_audio_url;
      const expectedTrans = type === "reply" ? p.reply_transliteration : p.phrase_transliteration;

      // Build choices: correct + up to 3 distractors. Fallback: pick from other phrases.
      let choiceDistractors = distractors.slice(0, 3);
      if (choiceDistractors.length < 3) {
        const fallback = shuffle(filtered.filter((f: any) => f.id !== p.id))
          .slice(0, 3 - choiceDistractors.length)
          .map((f: any) => ({ arabic: f.phrase_arabic, english: f.phrase_english ?? "" }));
        choiceDistractors = [...choiceDistractors, ...fallback];
      }

      const choices = shuffle([
        { arabic: expected, english: expectedEng ?? "", correct: true },
        ...choiceDistractors.map((d) => ({ arabic: d.arabic, english: d.english ?? "", correct: false })),
      ]);

      items.push({
        phrase_id: p.id,
        question_type: type,
        prompt: {
          arabic: type === "reply" ? p.phrase_arabic : undefined,
          english: type === "scenario" ? scenarioText ?? "Choose the right phrase to say." : undefined,
          audio_url: type === "reply" ? p.phrase_audio_url : null,
        },
        expected_arabic: expected,
        expected_english: expectedEng,
        expected_transliteration: expectedTrans,
        expected_audio_url: expectedAudio,
        cultural_note: p.cultural_note,
        formality: p.formality,
        occasion: p.set_phrase_occasions
          ? { name: p.set_phrase_occasions.name, icon_name: p.set_phrase_occasions.icon_name }
          : null,
        choices,
        is_due_review: due,
      });
    }

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("generate-set-phrase-quiz error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
