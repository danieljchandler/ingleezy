// generate-suggested-story-text — Expands a story suggestion (title +
// description) into full ENGLISH story text, ready to be imported directly via
// import-authentic-story. This closes the loop on the "Suggest Stories" flow so
// a suggestion can be turned into a real, importable story with a single tap.
//
// This is the reading library's empty-shelf path. The library prefers real
// imported texts — that is what "authentic" means, and it is why the importer
// exists — but a shelf with nothing on it teaches nobody, so an admin can
// generate a level-appropriate English piece rather than wait to find one that
// is both suitable and licensable.
//
// It emits ENGLISH only. Building the Arabic scaffold stays
// import-authentic-story's job, so a generated story and an imported one reach
// their dialect lines by exactly one path rather than two that can drift.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface GenerateRequest {
  title: string;
  /** The dialect title, when the suggestion carried one. Not required to generate English. */
  title_arabic?: string;
  description?: string;
  source_type?: string;
  estimated_length?: string;
  themes?: string[];
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

    const body: GenerateRequest = await req.json().catch(() => ({} as GenerateRequest));
    const { title } = body;
    if (!title) {
      return new Response(JSON.stringify({ error: "missing_fields", detail: "title is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetDialect = (body.dialect || "Gulf") as Dialect;
    const targetDifficulty = body.difficulty || "intermediate";

    const result = await askBrain<{
      body_english: string;
      author?: string;
    }>({
      purpose: "utility",
      // English target: everything this function writes is English, so the
      // MSA-leak scan and the dialect rulebook have nothing to police here.
      // The dialect is still passed because the CEFR-ish difficulty band is
      // about what THIS learner can read.
      target: "english",
      dialect: targetDialect,
      strategy: "solo",
      skipRepair: true,
      models: ["google/gemini-3-flash-preview"],
      systemPromptExtra: `You write ENGLISH reading material for Arabic speakers learning English.

Requirements:
- Write the COMPLETE text in natural, contemporary English suitable for a ${targetDifficulty} level learner. Not textbook-stiff English — the way it would really be written.
- Match the piece described: if it names a real, well-known public-domain story or folktale, retell it faithfully rather than summarising it. Otherwise write an original piece on the subject.
- Length: match "${body.estimated_length || "medium"}" (roughly 200-800 words).
- Use clear sentence boundaries — this will be split into lines for line-by-line reading, so avoid sprawling multi-clause sentences.
- Grade the vocabulary and grammar honestly to the level. A beginner piece that quietly uses B2 idioms is worse than a shorter one.
- If the piece has a known author, include it; otherwise leave the author field empty.
- Do not include the title inside the body text itself.`,
      userPrompt: `Write the full English text for this piece so it can be added to our reading library:

Title: ${title}
${body.description ? `Description: ${body.description}` : ""}
Source type: ${body.source_type || "folktale"}
Themes: ${(body.themes || []).join(", ")}

Write the complete English text now.`,
      maxTokens: 4000,
      temperature: 0.7,
      tool: {
        name: "emit_story_text",
        description: "Return the full English story text and optional author info.",
        parameters: {
          type: "object",
          properties: {
            body_english: { type: "string", description: "The complete English story text" },
            author: { type: "string", description: "Author name, if known" },
          },
          required: ["body_english"],
        },
      },
    });

    const bodyEnglish = result.output?.body_english;
    if (!bodyEnglish) {
      return new Response(JSON.stringify({ error: "generation_failed", detail: "AI failed to generate story text" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      body_english: bodyEnglish,
      author: result.output?.author ?? null,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("generate-suggested-story-text fatal:", e);
    const message = e instanceof Error ? e.message : "An unexpected error occurred";
    return new Response(JSON.stringify({ error: "internal", detail: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
