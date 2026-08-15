// import-authentic-story — Takes raw ENGLISH text + metadata, segments it into
// lines, and builds the Arabic scaffold for each: the learner's dialect
// translation plus a literal gloss in English word order. Also extracts a
// vocabulary list keyed on the English headword.
//
// The flip inverted what "authentic" means here. Hakiya pasted an Arabic text
// and produced an English translation to lean on; Ingleezy pastes a real
// English text — a news article, an essay, a short story — and produces the
// Arabic to lean on. The tashkeel step went with it: vocalisation is a reading
// aid for Arabic script, and nobody is reading Arabic script here any more.
//
// This is an Arabic-GENERATING call, so it keeps the default Arabic Brain
// target and the MSA-leak scan: everything the model writes (the dialect
// lines, the literal gloss, the vocabulary meanings) is Arabic that has to
// sound like the learner's dialect rather than Fusha. The English is given,
// not generated.
//
// Line columns keep their Arabic-era names and carry flipped content, the
// same convention the rest of the retarget uses:
//   english        — the English target sentence (now the primary text)
//   arabic         — the learner's dialect translation (the scaffold)
//   literal_arabic— the literal ARABIC gloss in English word order
// `arabic_vocalized` / `dialect` / `dialect_vocalized` are Arabic-source-era
// columns with nothing to hold post-flip and are left null.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { primeDialectPrompt, type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ImportRequest {
  title: string;
  /**
   * Optional post-flip. The admin pasting a real English article is not
   * necessarily an Arabic writer, and the dialect title is something the model
   * can produce from the English one — so it is generated when not supplied
   * rather than blocking the import.
   */
  title_arabic?: string;
  author?: string;
  author_arabic?: string;
  source_url?: string;
  source_name?: string;
  license?: string;
  body_english: string;
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
      body_english, dialect, difficulty,
    } = body;

    if (!title || !body_english) {
      return new Response(JSON.stringify({ error: "missing_fields", detail: "title and body_english are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prime dialect cache
    const targetDialect = (dialect || "Gulf") as Dialect;
    await primeDialectPrompt(targetDialect);

    // Segment the English into lines and build the Arabic scaffold for each.
    const processResult = await askBrain<{
      title_arabic?: string;
      lines: Array<{
        english: string;
        arabic: string;
        literal?: string;
      }>;
      vocabulary: Array<{ english: string; arabic: string }>;
    }>({
      purpose: "utility",
      dialect: targetDialect,
      strategy: "solo",
      skipRepair: true,
      models: ["google/gemini-2.5-flash"],
      systemPromptExtra: `You are processing a real ENGLISH text into line-by-line reading practice for an Arabic speaker learning English.

1. Split the English text into logical lines — each a complete sentence or short paragraph suitable for reading one at a time. Reproduce the English EXACTLY as given: do not translate it, summarise it, correct it or rewrite it. The English is the text the learner is here to read.
2. Translate each line into the learner's dialect as "arabic". Never Fusha — this is the language they think in, and it is the scaffold, not the lesson.
3. For each line also give a "literal" gloss: the Arabic words in ENGLISH word order, so the learner can see how the English sentence is built. Stiffness is expected and correct there — that is what makes the structure visible.
4. Extract 10-20 key vocabulary items: the ENGLISH word or phrase as it appears in the text, with its meaning in the learner's dialect. Choose words a learner at this level would actually stumble on, not the easy ones.
5. Give the story's title in the learner's dialect as "title_arabic".`,
      userPrompt: `Process this English text for the reading library.

Title: ${title}

${body_english}`,
      maxTokens: 12000,
      temperature: 0.2,
      tool: {
        name: "emit_processed_story",
        description: "Return the segmented English lines with their Arabic scaffold, plus vocabulary.",
        parameters: {
          type: "object",
          properties: {
            title_arabic: { type: "string", description: "The story title in the learner's dialect" },
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  english: { type: "string", description: "The English line, exactly as it appears in the source text" },
                  arabic: { type: "string", description: "The line translated into the learner's dialect" },
                  literal: { type: "string", description: "Word-for-word Arabic gloss preserving the ENGLISH word order; may sound stiff; shows how the English sentence is built." },
                },
                // `literal` is required rather than merely described: it is the
                // part that teaches sentence structure, and a model given the
                // option to skip it will.
                required: ["english", "arabic", "literal"],
              },
            },
            vocabulary: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  english: { type: "string", description: "The English word or phrase from the text" },
                  arabic: { type: "string", description: "Its meaning in the learner's dialect" },
                },
                required: ["english", "arabic"],
              },
            },
          },
          required: ["lines", "vocabulary"],
        },
      },
    });

    // Drop anything missing either half rather than letting it reach the
    // insert: `authentic_story_lines.arabic` is NOT NULL, so a single line the
    // model declined to translate would fail the whole batch and lose an
    // import the admin has already waited on. A story short a line is worth
    // more than no story.
    const lines = (processResult.output?.lines ?? []).filter(
      (l) => l?.english?.trim() && l?.arabic?.trim(),
    );
    const vocabulary = (processResult.output?.vocabulary ?? []).filter(
      (v) => v?.english?.trim() && v?.arabic?.trim(),
    );

    if (lines.length === 0) {
      return new Response(JSON.stringify({ error: "processing_failed", detail: "AI failed to segment the text" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the full body texts from the lines. `body_english` is now the
    // primary text and `body_dialect` the scaffold; the Fusha columns held the
    // Arabic *source* and have nothing to hold post-flip.
    const bodyEnglish = lines.map(l => l.english).join("\n");
    const bodyDialect = lines.map(l => l.arabic).join("\n");

    // Insert story
    const { data: story, error: insertErr } = await supabaseAdmin
      .from("authentic_stories")
      .insert({
        title,
        // Caller's dialect title wins; otherwise the one the model derived.
        title_arabic: title_arabic || processResult.output?.title_arabic || null,
        author: author || null,
        author_arabic: author_arabic || null,
        source_url: source_url || null,
        source_name: source_name || null,
        license: license || "public_domain",
        body_english: bodyEnglish,
        body_dialect: bodyDialect,
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

    // Insert story lines. `arabic` is NOT NULL and now carries the dialect
    // translation rather than an Arabic source line.
    const lineRows = lines.map((l, i) => ({
      story_id: story.id,
      line_index: i,
      english: l.english,
      arabic: l.arabic,
      literal_arabic: l.literal ?? null,
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
