// translate-story-dialect — Re-scaffolds an imported story into a different
// dialect: re-translates every ENGLISH line into the requested dialect and
// rewrites the literal gloss to match.
//
// The flip gave this function a better job than it had. It used to turn a
// Fusha source into dialect, a step that only existed because the source text
// was Arabic. Now the source is English and the dialect scaffold is built at
// import time — so what is actually useful is moving a story between
// dialects: a piece imported for a Gulf learner can be re-scaffolded for an
// Egyptian one without re-importing or re-narrating it, because the English
// (and therefore the audio) does not change.
//
// Tashkeel went with the flip: it is a reading aid for Arabic script, and the
// scaffold is there to be understood at a glance, not read aloud.

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

    // Admin only, like the other three functions behind the reading-library
    // admin screen. This one was missing the check: it rewrites every line of
    // a story that may already be published, so any signed-in account could
    // re-gloss the library out from under the learners reading it.
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

    // The English is the source of truth; a line without it has nothing to
    // re-translate from and is left as it stands.
    const translatable = lines.filter((l: { english?: string }) => l.english?.trim());
    if (translatable.length === 0) {
      return new Response(JSON.stringify({ error: "no_english_lines" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const translateResult = await askBrain<{
      lines: Array<{ arabic: string; literal: string }>;
    }>({
      purpose: "utility",
      dialect: targetDialect,
      strategy: "draft_critic",
      models: ["google/gemini-2.5-flash"],
      systemPromptExtra: `You are a native ${targetDialect} Arabic speaker glossing an English text for a ${targetDialect} speaker learning English.

For each numbered English line, return:
1. "arabic" — the line in natural, authentic ${targetDialect} dialect. Never Fusha. This is the language the learner thinks in, so it should read the way someone would actually say it.
2. "literal" — the Arabic words in ENGLISH word order, so the learner can see how the English sentence is built. Stiffness is expected and correct here; that is what makes the structure visible.

Return exactly one entry per numbered line, in the same order. Do not merge, split, reorder or skip lines.`,
      userPrompt: `Gloss these ${translatable.length} English lines into ${targetDialect}:\n${translatable.map((l: { english?: string }, i: number) => `${i + 1}. ${l.english}`).join("\n")}`,
      maxTokens: 6000,
      temperature: 0.3,
      tool: {
        name: "emit_dialect_lines",
        description: "Return the dialect gloss and literal gloss for each English line.",
        parameters: {
          type: "object",
          properties: {
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  arabic: { type: "string", description: `The line in ${targetDialect} dialect Arabic` },
                  literal: { type: "string", description: "Word-for-word Arabic gloss preserving the ENGLISH word order" },
                },
                required: ["arabic", "literal"],
              },
            },
          },
          required: ["lines"],
        },
      },
    });

    const glossed = translateResult.output?.lines ?? [];

    // Update each line with its new scaffold. Zipped by position, so a short
    // response updates the lines it covered and leaves the rest on the old
    // dialect rather than pairing line 5's gloss with line 9's English.
    let updated = 0;
    for (let i = 0; i < Math.min(translatable.length, glossed.length); i++) {
      const gloss = glossed[i];
      if (!gloss?.arabic?.trim()) continue;
      const { error: updateErr } = await supabaseAdmin
        .from("authentic_story_lines")
        .update({
          arabic: gloss.arabic,
          literal_arabic: gloss.literal ?? null,
        })
        .eq("id", translatable[i].id);
      if (updateErr) {
        console.warn(`Failed to update line ${i}:`, updateErr.message);
        continue;
      }
      updated++;
    }

    // Only move the story onto the new dialect if every line came with it.
    // A story labelled Egyptian whose second half is still Gulf is worse than
    // one that plainly failed to convert.
    const complete = updated === translatable.length;

    await supabaseAdmin
      .from("authentic_stories")
      .update({
        body_dialect: glossed.map((l) => l.arabic).join("\n"),
        ...(complete ? { dialect: targetDialect } : {}),
      })
      .eq("id", story_id);

    if (!complete) {
      return new Response(
        JSON.stringify({
          error: "partial_translation",
          lines_translated: updated,
          lines_expected: translatable.length,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ success: true, lines_translated: updated }), {
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
