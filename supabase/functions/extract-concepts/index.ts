// Extracts curriculum concepts (vocab lemmas, grammar points, themes) from
// approved content and upserts them into curriculum_concepts +
// content_concept_links. Called from useCurriculumApproval after every approval.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { canonicalGrammarKey, GRAMMAR_CATEGORY_SET } from "../_shared/grammarTaxonomy.ts";


interface ExtractedConcept {
  kind: "vocab" | "grammar" | "theme" | "scenario" | "phrase";
  key: string;             // normalized
  display_arabic?: string;
  display_english?: string;
  role?: "introduce" | "reinforce" | "assess";
}

// Lightweight heuristic extractor — fast, no LLM call.
// Pulls obvious vocab + theme + grammar tags from common content shapes.
function extractFromContent(
  contentType: string,
  row: Record<string, any>,
): ExtractedConcept[] {
  const out: ExtractedConcept[] = [];
  const seen = new Set<string>();
  const push = (c: ExtractedConcept) => {
    const k = `${c.kind}:${c.key}`;
    if (seen.has(k) || !c.key) return;
    seen.add(k);
    out.push(c);
  };

  const norm = (s: string) =>
    (s ?? "").trim().normalize("NFC").replace(/[\u064B-\u0652\u0670]/g, "");

  // The concept key is what the coverage planner dedupes and compares on, so
  // it has to name the thing being TAUGHT \u2014 the English. Keying on the Arabic
  // gloss (as this did when Arabic was the target) would file the same English
  // word under a different concept for every dialect that glosses it
  // differently, and the planner would keep re-introducing it.
  const key = (s: string) => norm(s).toLowerCase();

  // theme / scenario from titles
  const themeText = row.title || row.theme || row.title_arabic;
  if (themeText) {
    push({
      kind: contentType === "conversation" ? "scenario" : "theme",
      key: key(themeText),
      display_arabic: row.title_arabic || row.theme,
      display_english: row.title || row.description,
      role: "introduce",
    });
  }

  // vocab arrays
  const vocabArrays = [row.vocabulary, row.words, row.vocab].filter(Array.isArray);
  for (const arr of vocabArrays) {
    for (const w of arr) {
      const en = w?.english || w?.word_english;
      // A bare `word`/`translation` is the ambiguous legacy shape \u2014 no explicit
      // side, so it falls in with the Arabic and only keys the concept if
      // there's no English at all, rather than being guessed at as English.
      const ar = w?.arabic || w?.word_arabic || w?.word || w?.translation;
      const headword = en || ar;
      if (headword) push({
        kind: "vocab",
        key: key(headword),
        display_arabic: ar,
        display_english: en,
        role: "introduce",
      });
    }
  }


  // Grammar. The key goes through the shared taxonomy rather than being the
  // model's prose lower-cased: "Negation with ما", "negation of the past tense"
  // and "Past-tense negation" are one concept, and keying on the raw string
  // made three — none of which a learner's drill mastery could ever join to.
  // The prose is kept as display_english so the concept is still readable.
  //
  // grammar_exercises rows carry an explicit `category` from the fixed
  // taxonomy, which beats inferring one from prose, so it wins when present.
  const grammarCategory = typeof row.category === "string" && GRAMMAR_CATEGORY_SET.has(row.category)
    ? row.category
    : null;

  if (row.grammar_point) {
    push({
      kind: "grammar",
      key: grammarCategory ?? canonicalGrammarKey(row.grammar_point),
      display_english: row.grammar_point,
      role: contentType === "grammar" ? "introduce" : "reinforce",
    });
  }
  if (Array.isArray(row.grammar_points)) {
    for (const g of row.grammar_points) {
      const label = typeof g === "string" ? g : g?.point || g?.name;
      if (label) push({
        kind: "grammar",
        key: canonicalGrammarKey(label),
        display_english: label,
        role: "reinforce",
      });
    }
  }

  return out;
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

    const body = await req.json();
    const {
      content_type,
      content_id,
      content,           // optional pre-fetched row
      dialect = "Gulf",
      cefr_level = null,
      stage_id = null,
    } = body as Record<string, any>;

    if (!content_type || !content_id) {
      return new Response(JSON.stringify({ error: "content_type and content_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let row = content;
    if (!row) {
      // Map content_type -> table
      const tableMap: Record<string, string> = {
        lesson: "lessons",
        vocab: "lessons",
        grammar: "grammar_exercises",
        listening: "listening_exercises",
        reading: "reading_passages",
        daily_challenge: "daily_challenges",
        conversation: "conversation_scenarios",
      };
      const table = tableMap[content_type];
      if (table) {
        const { data } = await service.from(table).select("*").eq("id", content_id).maybeSingle();
        row = data || {};
      } else {
        row = {};
      }
    }

    const extracted = extractFromContent(content_type, row);
    const upsertedIds: string[] = [];

    for (const c of extracted) {
      const { data: up } = await service
        .from("curriculum_concepts")
        .upsert(
          {
            kind: c.kind,
            key: c.key,
            display_arabic: c.display_arabic,
            display_english: c.display_english,
            dialect,
            cefr_level,
            stage_id,
          },
          { onConflict: "kind,key,dialect" },
        )
        .select("id")
        .maybeSingle();
      if (up?.id) {
        upsertedIds.push(up.id);
        await service.from("content_concept_links").upsert(
          {
            concept_id: up.id,
            content_type,
            content_id,
            role: c.role ?? "introduce",
          },
          { onConflict: "concept_id,content_type,content_id,role" },
        );
      }
    }

    return new Response(JSON.stringify({ extracted: extracted.length, concept_ids: upsertedIds }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-concepts error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
