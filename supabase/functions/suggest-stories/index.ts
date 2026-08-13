// suggest-stories — AI generates 3 unique story ideas for the reading library,
// checking existing stories to avoid duplicates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface SuggestRequest {
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

    const body: SuggestRequest = await req.json().catch(() => ({}));
    const targetDialect = (body.dialect || "Gulf") as Dialect;
    const targetDifficulty = body.difficulty || "intermediate";

    // Fetch existing story titles to avoid duplicates
    const { data: existingStories } = await supabaseAdmin
      .from("authentic_stories")
      .select("title, title_arabic, difficulty, dialect");

    const existingTitles = (existingStories ?? [])
      .map((s: { title: string; title_arabic: string }) => `${s.title} / ${s.title_arabic}`)
      .join("\n");

    // Also fetch interactive stories to avoid overlap
    const { data: interactiveStories } = await supabaseAdmin
      .from("interactive_stories")
      .select("title, title_arabic");

    const interactiveTitles = (interactiveStories ?? [])
      .map((s: { title: string; title_arabic?: string }) => `${s.title}${s.title_arabic ? ` / ${s.title_arabic}` : ""}`)
      .join("\n");

    const allExisting = [existingTitles, interactiveTitles].filter(Boolean).join("\n");

    const result = await askBrain<{
      suggestions: Array<{
        title: string;
        title_arabic: string;
        description: string;
        description_arabic: string;
        source_type: string;
        estimated_length: string;
        themes: string[];
      }>;
    }>({
      purpose: "utility",
      dialect: targetDialect,
      strategy: "solo",
      skipRepair: true,
      models: ["google/gemini-3-flash-preview"],
      systemPromptExtra: `You are an expert Arabic literature curator for a language learning app. Your job is to suggest authentic Arabic stories suitable for reading practice.

Suggest stories from REAL sources — public domain Arabic literature, folktales, short stories by known authors, or well-known cultural narratives. These should be stories that actually exist or are well-known cultural narratives that can be faithfully reproduced.

Requirements:
- Suggest exactly 3 story options
- Each must be different in theme and style
- Target difficulty: ${targetDifficulty}
- Target dialect/register: ${targetDialect}
- Stories should be 200-800 words when written out
- Avoid any stories that overlap with existing content

Source types can be: "folktale", "short_story", "fable", "cultural_narrative", "poem", "proverb_collection", "historical_anecdote"

${allExisting ? `\nEXISTING STORIES TO AVOID (do not suggest anything similar):\n${allExisting}` : ""}`,
      userPrompt: `Suggest 3 authentic Arabic stories for our reading library. They should be appropriate for ${targetDifficulty} level learners studying ${targetDialect} Arabic. Each should be engaging and culturally rich. Provide the title in both English and Arabic, a compelling description in both languages, the source type, estimated length, and key themes.`,
      maxTokens: 2000,
      temperature: 0.9,
      tool: {
        name: "emit_suggestions",
        description: "Return 3 story suggestions with metadata.",
        parameters: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Story title in English" },
                  title_arabic: { type: "string", description: "Story title in Arabic" },
                  description: { type: "string", description: "2-3 sentence description in English explaining what the story is about and why it's good for learners" },
                  description_arabic: { type: "string", description: "2-3 sentence description in Arabic" },
                  source_type: { type: "string", description: "Type of source: folktale, short_story, fable, cultural_narrative, poem, proverb_collection, historical_anecdote" },
                  estimated_length: { type: "string", description: "short (200-300 words), medium (300-500 words), or long (500-800 words)" },
                  themes: { type: "array", items: { type: "string" }, description: "2-4 key themes like 'generosity', 'wisdom', 'family'" },
                },
                required: ["title", "title_arabic", "description", "description_arabic", "source_type", "estimated_length", "themes"],
              },
            },
          },
          required: ["suggestions"],
        },
      },
    });

    const suggestions = result.output?.suggestions ?? [];

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("suggest-stories fatal:", e);
    const message = e instanceof Error ? e.message : "An unexpected error occurred";
    return new Response(JSON.stringify({ error: "internal", detail: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
