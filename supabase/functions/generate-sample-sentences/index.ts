import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";


interface SentencesOut {
  sentences: Array<{ arabic: string; english: string; literal?: string }>;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "generate-sample-sentences", 30, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { word, dialect, definition } = await req.json();
    if (!word || typeof word !== 'string') {
      return new Response(JSON.stringify({ error: 'word is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // An example sentence is only useful if the learner can read the rest of it.
    // Keep the surrounding words inside their lexicon; the target word is the
    // one new thing. Weak words are excluded — an example sentence should not
    // stack two difficulties at once.
    const learnerBlock = await learnerPromptBlock({
      userId: cap.userId,
      dialect: dialect ?? 'Gulf',
      budget: { known: 80, learning: 10, weak: 0 },
      includeWeak: false,
      includeInterests: false,
    });

    const defLine = definition ? `\nDefinition/sense to use: "${String(definition).trim()}"` : '';
    const userPrompt = `Word: ${word.trim().slice(0, 100)}${defLine}\n\nGenerate 3 short, natural sentences in this dialect using the word in the given sense. Vary the contexts (home, work, with friends, etc.).`;

    const result = await askBrain<SentencesOut>({
      purpose: 'sample_sentences',
      dialect: dialect ?? 'Gulf',
      userPrompt,
      systemPromptExtra: `Task: generate natural, everyday EXAMPLE SENTENCES using the given word. The sentences must be conversational, NOT MSA, and reflect how a native speaker of this dialect would actually say them. For each sentence provide "english" (a natural translation) and "literal" (a word-for-word English gloss preserving the Arabic word order; it may sound stiff — it shows how the sentence is built).

${learnerBlock}`,
      strategy: 'ensemble',
      maxTokens: 600,
      temperature: 0.7,
      tool: {
        name: 'return_sentences',
        description: 'Return 3 example sentences in the requested dialect.',
        parameters: {
          type: 'object',
          properties: {
            sentences: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  arabic: { type: 'string' },
                  english: { type: 'string' },
                  literal: { type: 'string', description: 'Word-for-word English gloss preserving Arabic word order; may sound stiff.' },
                },
                required: ['arabic', 'english', 'literal'],
                additionalProperties: false,
              },
            },
          },
          required: ['sentences'],
          additionalProperties: false,
        },
      },
      arabicTextPath: (p) => (p as SentencesOut).sentences.map((s) => s.arabic).join(' '),
    });

    return new Response(JSON.stringify({
      sentences: Array.isArray(result.output.sentences) ? result.output.sentences.slice(0, 5) : [],
      _meta: { strategy: result.strategy, models: result.models, msaRepairs: result.msaRepairs },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    if (e instanceof BrainHttpError && (e.status === 402 || e.status === 429)) {
      return new Response(JSON.stringify({ error: e.status === 402 ? 'Credits exhausted' : 'Rate limited' }), {
        status: e.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('generate-sample-sentences error:', e);
    return new Response(JSON.stringify({ sentences: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
