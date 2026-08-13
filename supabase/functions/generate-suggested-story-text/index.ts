// generate-suggested-story-text — Expands an AI story suggestion (title + description)
// into the full authentic Arabic story text, ready to be imported directly via
// import-authentic-story. This closes the loop on the "Suggest Stories" flow so a
// suggestion can be turned into a real, importable story with a single tap.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface GenerateRequest {
  title: string;
  title_arabic: string;
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
    const { title, title_arabic } = body;
    if (!title || !title_arabic) {
      return new Response(JSON.stringify({ error: "missing_fields", detail: "title and title_arabic are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetDialect = (body.dialect || "Gulf") as Dialect;
    const targetDifficulty = body.difficulty || "intermediate";

    const result = await askBrain<{
      body_arabic: string;
      author?: string;
      author_arabic?: string;
    }>({
      purpose: "utility",
      dialect: targetDialect,
      strategy: "solo",
      skipRepair: true,
      models: ["google/gemini-3-flash-preview"],
      systemPromptExtra: `You are an expert in authentic Arabic literature. You faithfully write out the full text of real, well-known Arabic stories, folktales, fables, and cultural narratives (public domain / traditional material) so they can be used for language-learning reading practice.

Requirements:
- Write the COMPLETE story text in Modern Standard Arabic (Fusha), suitable for a ${targetDifficulty} level learner.
- The story should faithfully represent the real/traditional narrative described, not a vague summary.
- Length: match "${body.estimated_length || "medium"}" (roughly 200-800 words).
- Use clear sentences appropriate for line-by-line reading practice.
- If the story has a known traditional author, include it; otherwise leave author fields empty.
- Do not include the title inside the body text itself.`,
      userPrompt: `Write the full Arabic text for this story so it can be added to our reading library:

Title (English): ${title}
Title (Arabic): ${title_arabic}
${body.description ? `Description: ${body.description}` : ""}
Source type: ${body.source_type || "folktale"}
Themes: ${(body.themes || []).join(", ")}

Write the complete, faithful Arabic story text now.`,
      maxTokens: 4000,
      temperature: 0.7,
      tool: {
        name: "emit_story_text",
        description: "Return the full Arabic story text and optional author info.",
        parameters: {
          type: "object",
          properties: {
            body_arabic: { type: "string", description: "The complete Arabic story text" },
            author: { type: "string", description: "Author name in English, if known" },
            author_arabic: { type: "string", description: "Author name in Arabic, if known" },
          },
          required: ["body_arabic"],
        },
      },
    });

    const bodyArabic = result.output?.body_arabic;
    if (!bodyArabic) {
      return new Response(JSON.stringify({ error: "generation_failed", detail: "AI failed to generate story text" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      body_arabic: bodyArabic,
      author: result.output?.author ?? null,
      author_arabic: result.output?.author_arabic ?? null,
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
