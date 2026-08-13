// translate-story-dialect — Translates Fusha text into a specified dialect with tashkeel

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { primeDialectPrompt, type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const { story_id, dialect } = await req.json();
    if (!story_id || !dialect) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetDialect = dialect as Dialect;
    await primeDialectPrompt(targetDialect);

    // Fetch story lines
    const { data: lines, error: fetchErr } = await supabaseAdmin
      .from("authentic_story_lines")
      .select("*")
      .eq("story_id", story_id)
      .order("line_index", { ascending: true });

    if (fetchErr || !lines || lines.length === 0) {
      return new Response(JSON.stringify({ error: "story_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Translate all lines to dialect
    const arabicLines = lines.map((l: { arabic?: string; arabic_vocalized?: string }) => l.arabic || l.arabic_vocalized).join("\n");

    const translateResult = await askBrain<{
      lines: Array<{ dialect: string; dialect_vocalized: string }>;
    }>({
      purpose: "utility",
      dialect: targetDialect,
      strategy: "draft_critic",
      models: ["google/gemini-2.5-flash"],
      systemPromptExtra: `You are a native ${targetDialect} Arabic speaker and translator. Convert the given Modern Standard Arabic (Fusha) text into natural, authentic ${targetDialect} dialect Arabic. For each line:
1. Provide the dialect version in natural Arabic script
2. Provide the dialect version with full tashkeel (diacritics)
Keep the meaning faithful but make it sound natural in the dialect. Use authentic dialect vocabulary, grammar patterns, and expressions.`,
      userPrompt: `Translate these ${lines.length} Fusha Arabic lines into ${targetDialect} dialect:\n${lines.map((l: { arabic?: string }, i: number) => `${i + 1}. ${l.arabic}`).join("\n")}`,
      maxTokens: 6000,
      temperature: 0.3,
      tool: {
        name: "emit_dialect_lines",
        description: "Return dialect translations for each line.",
        parameters: {
          type: "object",
          properties: {
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  dialect: { type: "string", description: "Dialect Arabic text" },
                  dialect_vocalized: { type: "string", description: "Dialect Arabic with full tashkeel" },
                },
                required: ["dialect", "dialect_vocalized"],
              },
            },
          },
          required: ["lines"],
        },
      },
    });

    const dialectLines = translateResult.output?.lines ?? [];

    // Update each line with dialect translation
    for (let i = 0; i < Math.min(lines.length, dialectLines.length); i++) {
      const { error: updateErr } = await supabaseAdmin
        .from("authentic_story_lines")
        .update({
          dialect: dialectLines[i].dialect,
          dialect_vocalized: dialectLines[i].dialect_vocalized,
        })
        .eq("id", lines[i].id);
      if (updateErr) {
        console.warn(`Failed to update line ${i}:`, updateErr.message);
      }
    }

    // Update story-level dialect fields
    const bodyDialect = dialectLines.map(l => l.dialect).join("\n");
    const bodyDialectVocalized = dialectLines.map(l => l.dialect_vocalized).join("\n");

    await supabaseAdmin
      .from("authentic_stories")
      .update({
        body_dialect: bodyDialect,
        body_dialect_vocalized: bodyDialectVocalized,
        dialect: targetDialect,
      })
      .eq("id", story_id);

    return new Response(JSON.stringify({ success: true, lines_translated: dialectLines.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("translate-story-dialect fatal:", e);
    return new Response(JSON.stringify({ error: "internal", detail: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
