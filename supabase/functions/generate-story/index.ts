// generate-story — authors a complete interactive branching story in easy
// ENGLISH for the admin story builder. The scenes carry a dialect-Arabic
// scaffold (natural translation + a word-for-word gloss in English word
// order) so the learner reads English with their own Arabic a tap away.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "generate-story", 10, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { prompt, dialect, difficulty, sceneCount, guidance } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const numScenes = Math.max(3, Math.min(10, sceneCount || 5));
    const targetDialect: Dialect = (dialect || "Gulf") as Dialect;
    const targetDifficulty = difficulty || "Beginner";
    const dialectLabel = getDialectLabel(targetDialect);

    const systemExtra = `You are an expert English teacher creating interactive branching stories in ENGLISH at a ${targetDifficulty} level for native ${dialectLabel} Arabic speakers.

Generate a complete interactive story with exactly ${numScenes} scenes (numbered 0 to ${numScenes - 1}).

Story structure rules:
- Scene 0 is always the opening scene
- The LAST scene (scene ${numScenes - 1}) MUST be an ending scene (is_ending: true)
- At least one other scene should also be an ending (for alternate endings)
- Each non-ending scene must have 2-3 choices that lead to different scene numbers
- Choices must reference valid scene numbers (0 to ${numScenes - 1})
- Avoid circular references that trap the player
- The story should naturally lead toward the ending(s)

Difficulty rules at ${targetDifficulty} level:
- Beginner: simple short sentences, common everyday vocabulary
- Intermediate: more complex sentences, phrasal verbs, natural idiom
- Advanced: idiomatic expressions, complex grammar, rich cultural context
- The English is contemporary and natural — contractions welcome; textbook stiffness is a defect
- Each scene should teach 2-4 English vocabulary words

${guidance ? `Additional guidance from the author:\n${guidance}\n` : ""}

The Arabic scaffold on every scene:
- narrative_arabic: a natural ${dialectLabel} translation of the scene (authentic spoken dialect, NEVER Modern Standard Arabic / فصحى)
- narrative_literal: a word-for-word ${dialectLabel} gloss preserving the ENGLISH word order — it may sound stiff; its purpose is to show the learner how each English sentence is built
- choices' text_arabic and ending_message_arabic are ${dialectLabel} too

You MUST call the generate_story function. No text outside the function call.`;

    const userPrompt = `Create an interactive English story about: ${prompt}

The story should have ${numScenes} scenes. Make the narrative engaging and educational for a ${dialectLabel} Arabic speaker learning English. The choices should feel natural and meaningful, not arbitrary.`;

    const parameters = {
      type: "object",
      properties: {
        title: { type: "string", description: "Story title in English (catchy, descriptive)" },
        title_arabic: { type: "string", description: `Story title in ${dialectLabel} Arabic` },
        description: { type: "string", description: "1-2 sentence description of the story in English" },
        description_arabic: { type: "string", description: `1-2 sentence description in ${dialectLabel} Arabic` },
        scenes: {
          type: "array",
          description: `Array of exactly ${numScenes} scenes`,
          items: {
            type: "object",
            properties: {
              scene_order: { type: "number", description: "Scene index starting from 0" },
              narrative_english: { type: "string", description: "Scene narrative in natural English (2-4 sentences) — the learner's reading task" },
              narrative_arabic: { type: "string", description: `Natural ${dialectLabel} Arabic translation of the narrative (spoken dialect, never MSA)` },
              narrative_literal: { type: "string", description: "Word-for-word Arabic gloss of the narrative preserving the ENGLISH word order (may sound stiff; shows how the English is built)" },
              vocabulary: {
                type: "array",
                description: "2-4 key English words from this scene",
                items: {
                  type: "object",
                  properties: {
                    word_english: { type: "string", description: "The English word" },
                    word_arabic: { type: "string", description: `Its ${dialectLabel} meaning` },
                  },
                  required: ["word_english", "word_arabic"],
                  additionalProperties: false,
                },
              },
              is_ending: { type: "boolean", description: "True if this is an ending scene" },
              choices: {
                type: "array",
                description: "2-3 choices for non-ending scenes (empty for endings)",
                items: {
                  type: "object",
                  properties: {
                    text_english: { type: "string", description: "Choice text in English" },
                    text_arabic: { type: "string", description: `Choice text in ${dialectLabel} Arabic` },
                    next_scene_order: { type: "number", description: `Scene number to go to (1 to ${numScenes - 1})` },
                  },
                  required: ["text_english", "text_arabic", "next_scene_order"],
                  additionalProperties: false,
                },
              },
              ending_message: { type: "string", description: "Congratulatory message in English (null for non-endings)" },
              ending_message_arabic: { type: "string", description: `Congratulatory message in ${dialectLabel} Arabic (null for non-endings)` },
            },
            required: [
              "scene_order",
              "narrative_english",
              "narrative_arabic",
              "narrative_literal",
              "vocabulary",
              "is_ending",
              "choices",
              "ending_message",
              "ending_message_arabic",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "title_arabic", "description", "description_arabic", "scenes"],
      additionalProperties: false,
    };

    try {
      const result = await askBrain<{ scenes?: Array<{ narrative_english?: string }> }>({
        purpose: "story",
        dialect: targetDialect,
        target: "english",
        userPrompt,
        systemPromptExtra: systemExtra,
        strategy: "draft_critic",
        models: ["google/gemini-3-flash-preview", "openai/gpt-5-mini"],
        tool: {
          name: "generate_story",
          description: "Generate a complete interactive English story with scenes and choices",
          parameters,
        },
        maxTokens: 6000,
        temperature: 0.8,
      });

      console.log("generate-story brain result", {
        models: result.models,
        latencyMs: result.totalLatencyMs,
      });

      return new Response(JSON.stringify({ story: result.output }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      if (e instanceof BrainHttpError) {
        const status = e.status === 402 || e.status === 429 ? e.status : 500;
        const msg =
          e.status === 402
            ? "Not enough AI credits. Please add credits to your workspace."
            : e.status === 429
              ? "Rate limit exceeded. Please wait a moment and try again."
              : `AI service error: ${e.message}`;
        return new Response(JSON.stringify({ error: msg }), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("generate-story: unhandled error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
