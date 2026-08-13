// import-authentic-story — Takes raw Arabic text + metadata, segments into lines,
// adds tashkeel via AI, translates to English, generates vocabulary list.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { primeDialectPrompt, type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ImportRequest {
  title: string;
  title_arabic: string;
  author?: string;
  author_arabic?: string;
  source_url?: string;
  source_name?: string;
  license?: string;
  body_arabic: string;
  dialect?: string;
  difficulty?: string;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify admin
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const isAdmin = roles?.some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ImportRequest = await req.json();
    const {
      title, title_arabic, author, author_arabic,
      source_url, source_name, license,
      body_arabic, dialect, difficulty,
    } = body;

    if (!title || !title_arabic || !body_arabic) {
      return new Response(JSON.stringify({ error: "missing_fields", detail: "title, title_arabic, and body_arabic are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prime dialect cache
    const targetDialect = (dialect || "Gulf") as Dialect;
    await primeDialectPrompt(targetDialect);

    // Step 1: Segment text into lines, add tashkeel, translate to English, extract vocabulary
    const processResult = await askBrain<{
      lines: Array<{
        arabic: string;
        arabic_vocalized: string;
        english: string;
        literal?: string;
      }>;
      vocabulary: Array<{ arabic: string; english: string; root?: string }>;
    }>({
      purpose: "utility",
      dialect: targetDialect,
      strategy: "solo",
      skipRepair: true,
      models: ["google/gemini-2.5-flash"],
      systemPromptExtra: `You are an expert Arabic text processor. Given a block of Arabic text:
1. Split it into logical lines/sentences (each line should be a complete sentence or short paragraph suitable for line-by-line reading).
2. Add full tashkeel (diacritics) to each line.
3. Translate each line to natural English.
3b. ALSO provide a "literal" word-for-word English gloss of each line, preserving the Arabic word order (it may sound stiff — it shows how the sentence is built).
4. Extract 10-20 key vocabulary items with their English meanings and Arabic root (if applicable).
Maintain the original text faithfully — do not summarize or alter meaning.`,
      userPrompt: `Process this Arabic text into lines with tashkeel and English translations:\n\n${body_arabic}`,
      maxTokens: 12000,
      temperature: 0.2,
      tool: {
        name: "emit_processed_story",
        description: "Return processed story lines and vocabulary.",
        parameters: {
          type: "object",
          properties: {
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  arabic: { type: "string", description: "Original Arabic line" },
                  arabic_vocalized: { type: "string", description: "Arabic line with full tashkeel" },
                  english: { type: "string", description: "Natural English translation" },
                  literal: { type: "string", description: "Word-for-word English gloss preserving Arabic word order; may sound stiff; shows sentence structure." },
                },
                required: ["arabic", "arabic_vocalized", "english"],
              },
            },
            vocabulary: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  arabic: { type: "string" },
                  english: { type: "string" },
                  root: { type: "string" },
                },
                required: ["arabic", "english"],
              },
            },
          },
          required: ["lines", "vocabulary"],
        },
      },
    });

    const lines = processResult.output?.lines ?? [];
    const vocabulary = processResult.output?.vocabulary ?? [];

    if (lines.length === 0) {
      return new Response(JSON.stringify({ error: "processing_failed", detail: "AI failed to segment the text" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build full body texts from lines
    const bodyFusha = lines.map(l => l.arabic).join("\n");
    const bodyFushaVocalized = lines.map(l => l.arabic_vocalized).join("\n");
    const bodyEnglish = lines.map(l => l.english).join("\n");

    // Insert story
    const { data: story, error: insertErr } = await supabaseAdmin
      .from("authentic_stories")
      .insert({
        title,
        title_arabic,
        author: author || null,
        author_arabic: author_arabic || null,
        source_url: source_url || null,
        source_name: source_name || null,
        license: license || "public_domain",
        body_fusha: bodyFusha,
        body_fusha_vocalized: bodyFushaVocalized,
        body_english: bodyEnglish,
        dialect: targetDialect,
        difficulty: difficulty || "intermediate",
        vocabulary,
        status: "draft",
        created_by: user.id,
      })
      .select("*")
      .single();

    if (insertErr || !story) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: "save_failed", detail: insertErr?.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert story lines
    const lineRows = lines.map((l, i) => ({
      story_id: story.id,
      line_index: i,
      arabic: l.arabic,
      arabic_vocalized: l.arabic_vocalized,
      english: l.english,
      english_literal: l.literal ?? null,
    }));

    const { error: linesErr } = await supabaseAdmin
      .from("authentic_story_lines")
      .insert(lineRows);

    if (linesErr) {
      console.warn("Failed to insert lines:", linesErr.message);
    }

    return new Response(JSON.stringify({ story }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("import-authentic-story fatal:", e);
    return new Response(JSON.stringify({ error: "internal", detail: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
