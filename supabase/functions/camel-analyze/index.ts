/**
 * camel-analyze — Arabic text analysis via:
 *   • Farasa REST API (QCRI)  → diacritization, morphological segmentation, POS tagging
 *   • CAMeL-Lab HuggingFace models (NYU Abu Dhabi) → dialect identification
 *
 * Actions:
 *   diacritize  - Add tashkeel (short vowels) to unvoweled Arabic text
 *   segment     - Morphological segmentation (prefix/stem/suffix breakdown)
 *   pos         - Part-of-speech tagging
 *   dialect     - Identify Gulf dialect variant (Kuwait/Qatar/UAE/Saudi/Oman/Bahrain/MSA)
 *
 * Env vars required:
 *   HUGGINGFACE_API_KEY  — for CAMeL-Lab dialect model
 *
 * Env vars optional (Farasa is free/no-auth):
 *   (none — Farasa webapi is public)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { callCamelDialect } from "../_shared/camelDialect.ts";


// ── Farasa REST API ──────────────────────────────────────────────────────────

const FARASA_BASE = 'https://farasa.qcri.org/webapi';

type FarasaTask = 'diac' | 'seg' | 'pos' | 'NER';

/**
 * Call a Farasa WebAPI endpoint.
 * Returns the processed text string, or null on failure.
 *
 * Farasa returns different formats per task:
 *   diac → plain diacritized string
 *   seg  → space-separated morpheme+ string (prefix+stem+suffix)
 *   pos  → "word/TAG word/TAG ..." string
 */
async function callFarasa(task: FarasaTask, text: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const body = new URLSearchParams({ text });
    const response = await fetch(`${FARASA_BASE}/${task}/`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`Farasa ${task} error ${response.status}:`, errText.slice(0, 200));
      return null;
    }

    // Farasa returns JSON: { "text": "...", "output": "..." } — field name varies by task
    const data = await response.json();
    return (data.text ?? data.output ?? data.result ?? null) as string | null;
  } catch (e) {
    console.warn(`Farasa ${task} failed:`, e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── POS tag output parser ────────────────────────────────────────────────────

interface PosToken {
  word: string;
  tag: string;
  tagDescription: string;
}

/** Map common Farasa POS tags to human-readable labels for learners. */
const POS_DESCRIPTIONS: Record<string, string> = {
  'NNP': 'Proper noun',
  'NN':  'Noun',
  'VBP': 'Verb (present)',
  'VBD': 'Verb (past)',
  'VBN': 'Verb (participle)',
  'JJ':  'Adjective',
  'RB':  'Adverb',
  'IN':  'Preposition',
  'CC':  'Conjunction',
  'DT':  'Determiner',
  'PRP': 'Pronoun',
  'CD':  'Number',
  'PUNC':'Punctuation',
  'UH':  'Interjection',
  'FW':  'Foreign word',
};

/** Parse "word/TAG word/TAG ..." output from Farasa POS endpoint. */
function parsePosOutput(raw: string): PosToken[] {
  return raw.trim().split(/\s+/).map(token => {
    const lastSlash = token.lastIndexOf('/');
    if (lastSlash === -1) return { word: token, tag: '?', tagDescription: 'Unknown' };
    const word = token.slice(0, lastSlash);
    const tag  = token.slice(lastSlash + 1);
    return { word, tag, tagDescription: POS_DESCRIPTIONS[tag] ?? tag };
  });
}

// ── Morphological segment parser ─────────────────────────────────────────────

interface MorphSegment {
  /** The raw segmented token, e.g. "و+ذهب+ت" */
  raw: string;
  /** Prefix clitics (e.g. conjunction "و", preposition "ب") */
  prefixes: string[];
  /** Core stem */
  stem: string;
  /** Suffix clitics (e.g. pronoun "ت", definiteness "ال") */
  suffixes: string[];
}

/**
 * Parse Farasa segmentation output.
 * Farasa marks boundaries with "+", e.g. "ب+الكتاب" → prefix ب, stem الكتاب
 */
function parseSegOutput(raw: string): MorphSegment[] {
  return raw.trim().split(/\s+/).map(token => {
    const parts = token.split('+');
    // Heuristic: if first part is short (1-2 chars) it's a prefix; last similarly
    const prefixes: string[] = [];
    const suffixes: string[] = [];
    let stemIdx = 0;
    let stemEnd = parts.length - 1;

    // Common Arabic prefixes (single-char clitics)
    const PREFIX_SET = new Set(['و', 'ف', 'ب', 'ل', 'ك', 'لل', 'ال', 'وال', 'فال', 'بال', 'كال']);
    const SUFFIX_SET = new Set(['ه', 'ها', 'هم', 'هن', 'ي', 'ك', 'نا', 'كم', 'هما', 'تم', 'ت', 'وا', 'ون', 'ين', 'ان']);

    while (stemIdx < stemEnd && PREFIX_SET.has(parts[stemIdx])) {
      prefixes.push(parts[stemIdx++]);
    }
    while (stemEnd > stemIdx && SUFFIX_SET.has(parts[stemEnd])) {
      suffixes.unshift(parts[stemEnd--]);
    }

    return {
      raw: token,
      prefixes,
      stem: parts.slice(stemIdx, stemEnd + 1).join('+'),
      suffixes,
    };
  });
}

// ── CAMeL-Lab Dialect Identification ─────────────────────────────────────────
// The MADAR label map, response parsing and HTTP client live in
// _shared/camelDialect.ts. This function used to carry its own copy while the
// video pipeline carried a narrower Gulf-only one; they disagreed on which
// predictions counted, so the same model produced different verdicts depending
// on which entry point called it.


// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, actions } = body as {
      text: string;
      actions?: ('diacritize' | 'segment' | 'pos' | 'dialect')[];
    };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: diacritize only (most universally useful)
    const requestedActions = actions ?? ['diacritize'];

    const wantDiac    = requestedActions.includes('diacritize');
    const wantSegment = requestedActions.includes('segment');
    const wantPos     = requestedActions.includes('pos');
    const wantDialect = requestedActions.includes('dialect');

    console.log(`camel-analyze: text="${text.slice(0, 60)}" actions=[${requestedActions.join(',')}]`);

    // ── Parallel API calls ────────────────────────────────────────────────────

    const hfApiKey = Deno.env.get('HUGGINGFACE_API_KEY') ?? '';

    const [diacResult, segResult, posResult, dialectResult] = await Promise.all([
      wantDiac    ? callFarasa('diac', text)                          : Promise.resolve(null),
      wantSegment ? callFarasa('seg', text)                           : Promise.resolve(null),
      wantPos     ? callFarasa('pos', text)                           : Promise.resolve(null),
      wantDialect ? callCamelDialect(text, hfApiKey, { maxChars: 512, timeoutMs: 30_000 })
                  : Promise.resolve(null),
    ]);

    // ── Build response ────────────────────────────────────────────────────────

    const result: Record<string, unknown> = {
      inputText: text,
      actions: requestedActions,
    };

    if (wantDiac) {
      result.diacritized = diacResult ?? null;
      result.diacritizeAvailable = diacResult !== null;
    }

    if (wantSegment && segResult) {
      result.segmentedRaw = segResult;
      result.segments = parseSegOutput(segResult);
    } else if (wantSegment) {
      result.segments = null;
    }

    if (wantPos && posResult) {
      result.posTaggedRaw = posResult;
      result.posTokens = parsePosOutput(posResult);
    } else if (wantPos) {
      result.posTokens = null;
    }

    if (wantDialect) {
      // The client reports why it failed, so the caller no longer has to infer
      // "cold start" from the absence of a result.
      result.dialect = dialectResult?.ok ? { ...dialectResult.result, source: 'camel-hf' } : null;
      if (dialectResult && !dialectResult.ok) {
        result.dialectErrorReason = dialectResult.reason;
        result.dialectError = dialectResult.reason === 'no_api_key'
          ? 'HUGGINGFACE_API_KEY not configured — set this secret in Supabase dashboard'
          : dialectResult.reason === 'http_503'
            ? 'CAMeL-Lab model is cold-starting — retry in ~30s'
            : `CAMeL-Lab model unavailable (${dialectResult.reason})`;
      }
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('camel-analyze error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
