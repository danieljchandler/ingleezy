// Extracts level-tagged dialect grammar points from a Discover video transcript
// and appends them to discover_videos.grammar_points. Avoids duplicating
// existing titles. Callable by signed-in users (target their own level) or
// admins (any level).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


type Cefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

interface GrammarPoint {
  title: string;
  explanation: string;
  examples: string[];
  cefr_level?: Cefr;
}

const LEVEL_GUIDE: Record<Cefr, string> = {
  A1: "Very simple patterns: pronouns, basic negation, definite article, possessive suffixes, present-tense conjugation, common question words.",
  A2: "Past tense, simple imperatives, plurals, common prepositions, basic dialect particles (e.g. ما, مو, مش).",
  B1: "Aspect markers (ب/ع/قاعد/راح/بدي), conditional with لو, comparative/superlative, common dialect connectors.",
  B2: "Subjunctive vs. indicative, embedded clauses, نفي compound forms, dialect-specific verb modifiers, idiomatic prepositions.",
  C1: "Subtle register shifts, MSA↔dialect alternations, fronting/topicalization, discourse particles (يعني, طيب), nuanced modality.",
  C2: "Idiomatic syntax, poetic/proverbial structures, sociolinguistic register, fine MSA contrast and code-switching.",
};

function normTitle(t: string): string {
  return (t ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFC")
    .replace(/[\u064B-\u0652\u0670]/g, "")
    .replace(/\s+/g, " ");
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const videoId: string = body.video_id;
    const targetLevelRaw: string = (body.target_level || "B1").toUpperCase();
    const target_level: Cefr = (["A1","A2","B1","B2","C1","C2"].includes(targetLevelRaw) ? targetLevelRaw : "B1") as Cefr;
    const count = Math.max(1, Math.min(8, Number(body.count) || 4));

    if (!videoId) {
      return new Response(JSON.stringify({ error: "video_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: video, error: vErr } = await service
      .from("discover_videos")
      .select("id, dialect, difficulty, transcript_lines, grammar_points")
      .eq("id", videoId)
      .single();
    if (vErr || !video) {
      return new Response(JSON.stringify({ error: "Video not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existing: GrammarPoint[] = Array.isArray(video.grammar_points) ? (video.grammar_points as any[]) : [];
    const existingTitles = existing.map((p) => p?.title).filter(Boolean);
    const existingTitleSet = new Set(existingTitles.map(normTitle));

    const lines = Array.isArray(video.transcript_lines) ? (video.transcript_lines as any[]) : [];
    if (lines.length === 0) {
      return new Response(JSON.stringify({ error: "Video has no transcript yet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // English videos carry the spoken line in `english` and the dialect gloss
    // in `arabic` (see src/types/transcript.ts); Hakiya-bridged Arabic videos
    // have no `english` at all. There is no English grammar to observe in an
    // Arabic clip, so rather than let the model invent points off a machine
    // translation, say so — the bridge serves those clips as immersion.
    if (!lines.some((l: any) => (l?.english ?? "").trim())) {
      return new Response(
        JSON.stringify({
          error: "This clip is spoken in Arabic — there is no English grammar to extract.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const transcriptSnippet = lines.slice(0, 60).map((l: any, i: number) =>
      `${i + 1}. ${l.english ?? ""}${l.arabic ? "  —  " + l.arabic : ""}`
    ).join("\n");

    const dialect = video.dialect || "Gulf";
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an English coach for native ${dialect} Arabic speakers. Extract ENGLISH grammar notes from a real transcript that are useful for a learner at CEFR ${target_level}.

LEVEL GUIDANCE for ${target_level}:
${LEVEL_GUIDE[target_level]}

RULES:
- Focus on ENGLISH grammar, and favour the patterns ${dialect} speakers get wrong: articles (a/an/the), the missing copula ("he tired"), verb tense and the third-person -s, prepositions that do not map, word order, plurals and countability.
- Each point must be GROUNDED in the transcript — quote 1–2 real ENGLISH lines from it as examples.
- Difficulty must match ${target_level}: do NOT pick patterns that are too basic or too advanced.
- AVOID these titles already covered for this video (do not return any near-duplicates): ${existingTitles.length ? existingTitles.map((t) => `"${t}"`).join(", ") : "(none)"}.
- Titles must be short (≤ 6 words), IN ARABIC, and describe the pattern, not the example.
- Explanations must be 1–3 sentences in ${dialect} Arabic — that is the language the learner thinks in. Name the English structure in English inside the Arabic sentence when it helps.
- Return exactly ${count} new points.`;

    const userPrompt = `Transcript (first ${lines.length > 60 ? 60 : lines.length} lines):
${transcriptSnippet}

Return ONLY JSON of the form:
{"points":[{"title":"...","explanation":"...","examples":["...","..."],"cefr_level":"${target_level}"}]}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text().catch(() => "");
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached, try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI gateway error: ${aiResp.status}`, detail: errText.slice(0, 300) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "";
    let parsed: { points?: GrammarPoint[] } = {};
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    } catch (e) {
      console.warn("Failed to parse AI JSON", e);
    }

    const candidates = Array.isArray(parsed.points) ? parsed.points : [];
    const fresh: GrammarPoint[] = [];
    for (const p of candidates) {
      if (!p?.title || !p?.explanation) continue;
      const key = normTitle(p.title);
      if (!key || existingTitleSet.has(key)) continue;
      existingTitleSet.add(key);
      fresh.push({
        title: String(p.title).slice(0, 120),
        explanation: String(p.explanation).slice(0, 600),
        examples: Array.isArray(p.examples) ? p.examples.slice(0, 3).map((s) => String(s).slice(0, 300)) : [],
        cefr_level: target_level,
      });
    }

    if (fresh.length === 0) {
      return new Response(JSON.stringify({ added: 0, points: [], message: "No new grammar points (all duplicates or invalid)." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const merged = [...existing, ...fresh];
    const { error: upErr } = await service
      .from("discover_videos")
      .update({ grammar_points: merged })
      .eq("id", videoId);
    if (upErr) {
      return new Response(JSON.stringify({ error: `Failed to save: ${upErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ added: fresh.length, points: fresh, total: merged.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-grammar-points error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
