import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getDialectTransliterationRules, type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


interface EnrichmentOut {
  definition?: string | null;
  literal?: string | null;
  transliteration?: string | null;
  uses?: Array<{ arabic: string; english: string }>;
}

/**
 * No `root` here any more, and its absence is deliberate.
 *
 * This function serves the Hakiya-bridged Arabic clips: the learner taps an
 * Arabic word and gets its English meaning. Pre-flip it also returned the
 * Arabic triliteral root, which the save path wrote into
 * `user_vocabulary.root`. That column now carries an ENGLISH word family, so
 * an Arabic root written there is worse than nothing twice over — the client
 * refuses to display it, and because `enrich-word-roots` only fills rows where
 * `root IS NULL`, the row is permanently locked out of ever getting its real
 * family. Leaving it null is what lets the backfill do its job.
 */

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, 'word-enrichment', 60, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { word, dialect, sentenceArabic, sentenceEnglish, isPhrase: isPhraseFlag } = await req.json();
    if (!word || typeof word !== 'string') {
      return new Response(JSON.stringify({ error: 'word is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const trimmed = word.trim().slice(0, 200);
    const isPhrase = Boolean(isPhraseFlag) || /\s/.test(trimmed);

    const hasContext = typeof sentenceArabic === 'string' && sentenceArabic.trim().length > 0;
    const contextLine = hasContext
      ? `\n\nCONTEXT — the ${isPhrase ? 'phrase' : 'word'} appears in this sentence:\nArabic: "${String(sentenceArabic).trim()}"${typeof sentenceEnglish === 'string' && sentenceEnglish.trim() ? `\nEnglish: "${String(sentenceEnglish).trim()}"` : ''}\n\nFor "definition": choose the sense that fits THIS sentence — the meaning consistent with the English translation above, not the most common dictionary meaning.`
      : '';

    const systemExtra = isPhrase
      ? `Task: given a multi-word Arabic PHRASE or expression, return its IDIOMATIC English meaning as a whole — NOT word-by-word — in "definition". SEPARATELY, in "literal", give a word-for-word English gloss that preserves the Arabic word order (may sound stiff — it shows how the phrase is built). Also return up to 3 related expressions in the SAME dialect.`
      : `Task: given an Arabic word, return its English definition and up to 3 related words/expressions in the SAME dialect.`;

    // literal (word-for-word gloss) only makes sense for multi-word phrases.
    const phraseProps = isPhrase
      ? { literal: { type: 'string', description: 'Word-for-word English gloss preserving Arabic word order; may sound stiff.' } }
      : {};
    const phraseRequired = isPhrase ? ['literal'] : [];

    const resolvedDialect = (dialect ?? 'Gulf') as Dialect;
    const userPrompt = `${isPhrase ? 'Phrase' : 'Word'}: ${trimmed}${contextLine}`;

    const result = await askBrain<EnrichmentOut>({
      purpose: 'vocab_definition',
      dialect: resolvedDialect,
      userPrompt,
      systemPromptExtra: `${systemExtra}\n\n${getDialectTransliterationRules(resolvedDialect)}\nAlso return a transliteration of the word/phrase itself.`,
      strategy: 'ensemble',
      maxTokens: 512,
      temperature: 0.2,
      tool: {
        name: 'return_enrichment',
        description: 'Return the word/phrase definition, transliteration, and related uses.',
        parameters: {
          type: 'object',
          properties: {
            definition: { type: 'string', description: 'English meaning' },
            ...phraseProps,
            transliteration: { type: 'string', description: 'Latin-letter transliteration of the word/phrase' },
            uses: {
              type: 'array',
              description: 'Up to 3 related expressions in the same dialect',
              items: {
                type: 'object',
                properties: {
                  arabic: { type: 'string' },
                  english: { type: 'string' },
                },
                required: ['arabic', 'english'],
                additionalProperties: false,
              },
            },
          },
          required: ['definition', ...phraseRequired, 'transliteration', 'uses'],
          additionalProperties: false,
        },
      },
      arabicTextPath: (p) => {
        const o = p as EnrichmentOut;
        return (o.uses ?? []).map((u) => u.arabic).join(' ');
      },
    });

    const out = result.output;
    return new Response(JSON.stringify({
      definition: out.definition || null,
      literal: out.literal || null,
      transliteration: out.transliteration || null,
      uses: Array.isArray(out.uses) ? out.uses.slice(0, 5) : [],
      _meta: { strategy: result.strategy, models: result.models, msaRepairs: result.msaRepairs },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    if (e instanceof BrainHttpError && (e.status === 402 || e.status === 429)) {
      return new Response(JSON.stringify({ error: e.status === 402 ? 'Credits exhausted' : 'Rate limited' }), {
        status: e.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('word-enrichment error:', e);
    return new Response(JSON.stringify({ uses: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
