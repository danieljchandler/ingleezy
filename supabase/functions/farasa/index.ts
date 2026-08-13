/**
 * farasa — Dedicated Farasa NLP API edge function.
 *
 * Exposes all five Farasa WebAPI tasks for Arabic text analysis:
 *
 *   diac     Diacritization — adds short vowel marks (tashkeel) to unvoweled Arabic.
 *            Feed output to ElevenLabs TTS for accurate Gulf Arabic pronunciation.
 *
 *   seg      Morphological segmentation — splits words into prefix+stem+suffix
 *            components using the CLITICS boundary system. Useful for showing
 *            learners how Arabic words are structurally composed.
 *
 *   pos      Part-of-speech tagging — labels each token with its grammatical role
 *            (noun, verb, preposition, etc.). Returns both raw tags and
 *            human-readable descriptions.
 *
 *   NER      Named entity recognition — identifies PERSON, LOCATION, ORGANIZATION
 *            and other named entities. Useful for video transcript analysis to
 *            detect place names and proper nouns in Gulf Arabic content.
 *
 *   parsing  Dependency parsing — produces a CoNLL-format tree showing how words
 *            relate to each other grammatically (subject, object, modifier, etc.).
 *            Advanced learner feature for understanding sentence structure.
 *
 * Request body:
 *   { text: string, tasks?: FarasaTask[] }
 *   Default tasks: ['diac']
 *
 * Auth: set FARASA_API_KEY (register at farasa.qcri.org). The endpoints that
 * once served anonymous traffic now answer "invalid api key. please register",
 * so without the secret every task fails and the response carries
 * `<task>Error: "invalid_api_key"` plus a top-level `configHint`.
 *
 * Rate limiting: Farasa may throttle high-frequency requests. Each task is an
 * independent HTTP call; run only the tasks you need.
 *
 * Source: https://farasa.qcri.org  (Qatar Computing Research Institute)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { callFarasa, type FarasaFailureReason, type FarasaTask } from "../_shared/farasa.ts";

export type { FarasaTask };

// ── Result types ──────────────────────────────────────────────────────────────

export interface DiacResult {
  /** Arabic text with full tashkeel (short vowel marks) added */
  text: string;
}

export interface SegToken {
  /** Original unmodified word */
  original: string;
  /** Boundary-marked form as returned by Farasa, e.g. "ب+الكتاب" */
  segmented: string;
  /** Clitic prefixes detached from stem (conjunctions, prepositions, determiners) */
  prefixes: string[];
  /** Core lexical stem */
  stem: string;
  /** Clitic suffixes (pronoun clitics, feminine marker, dual/plural endings) */
  suffixes: string[];
}

// POS tag descriptions for language learners (PATB / Penn Arabic Treebank tagset)
const POS_LABEL: Record<string, string> = {
  'NNP': 'Proper noun',     'NNPS': 'Proper noun (pl)',
  'NN':  'Noun',            'NNS':  'Noun (plural)',
  'VBP': 'Verb (present)',  'VBD':  'Verb (past)',
  'VBN': 'Verb (participle)','VBG': 'Verb (active part.)',
  'VB':  'Verb (base)',
  'JJ':  'Adjective',       'JJR':  'Adjective (comp.)',  'JJS': 'Adjective (super.)',
  'RB':  'Adverb',          'RBR':  'Adverb (comp.)',
  'IN':  'Preposition',
  'CC':  'Conjunction',
  'DT':  'Determiner',
  'PRP': 'Pronoun',         'PRP$': 'Possessive pronoun', 'WP': 'Wh-pronoun',
  'WRB': 'Wh-adverb',       'WDT':  'Wh-determiner',
  'CD':  'Number',
  'PUNC':'Punctuation',
  'UH':  'Interjection',
  'FW':  'Foreign word',
  'RP':  'Particle',
  'TO':  'Particle "to"',
  'EX':  'Existential',
  'SYM': 'Symbol',
  'ABBREV': 'Abbreviation',
  'NO_FUNC': 'Function word',
};

export interface PosToken {
  word: string;
  tag: string;
  /** Human-readable label for the POS tag */
  label: string;
}

// NER entity type descriptions
const NER_LABEL: Record<string, string> = {
  'PERS':  'Person',
  'PERSON':'Person',
  'LOC':   'Location',
  'ORG':   'Organization',
  'MISC':  'Miscellaneous',
  'DATE':  'Date',
  'TIME':  'Time',
  'MONEY': 'Money',
  'NUM':   'Number',
  'PERCENT': 'Percentage',
};

export interface NerEntity {
  /** The entity text as it appears in the original */
  text: string;
  /** NER type code (e.g. "PERS", "LOC", "ORG") */
  type: string;
  /** Human-readable entity type label */
  typeLabel: string;
}

export interface NerResult {
  entities: NerEntity[];
  /** Raw Farasa NER output for debugging */
  raw: string;
}

// CoNLL dependency parsing row
export interface DepToken {
  /** 1-based token index */
  index: number;
  word: string;
  lemma?: string;
  pos?: string;
  /** 1-based index of head token (0 = root) */
  head: number;
  /** Dependency relation label (SBJ, OBJ, MOD, ROOT, …) */
  relation: string;
  /** Human-readable relation description */
  relationLabel: string;
}

const DEP_LABEL: Record<string, string> = {
  'ROOT': 'Root of sentence',
  'SBJ':  'Subject',
  'OBJ':  'Object',
  'MOD':  'Modifier',
  'PMOD': 'Prepositional modifier',
  'NMOD': 'Noun modifier',
  'VMOD': 'Verbal modifier',
  'AMOD': 'Adjectival modifier',
  'PRD':  'Predicate',
  'COORD':'Coordination',
  'CONJ': 'Conjunct',
  'DEP':  'Dependent',
  'P':    'Punctuation',
  'SUB':  'Subordinate clause',
};

// ── Output parsers ────────────────────────────────────────────────────────────

// Clitic prefixes common in Arabic
const PREFIX_SET = new Set([
  'و', 'ف', 'ب', 'ل', 'ك', 'لل', 'ال', 'وال', 'فال', 'بال', 'كال',
  'أو', 'لـ', 'بـ', 'وبـ', 'فبـ',
]);
// Clitic suffixes common in Arabic
const SUFFIX_SET = new Set([
  'ه', 'ها', 'هم', 'هن', 'هما', 'ي', 'ك', 'كم', 'كن', 'كما',
  'نا', 'نى', 'تم', 'تن', 'تما', 'ت', 'وا', 'ون', 'ين', 'ان', 'ات',
]);

function parseSegmentation(raw: string): SegToken[] {
  return raw.trim().split(/\s+/).map(token => {
    const parts = token.split('+');
    let lo = 0;
    let hi = parts.length - 1;
    const prefixes: string[] = [];
    const suffixes: string[] = [];

    while (lo < hi && PREFIX_SET.has(parts[lo])) prefixes.push(parts[lo++]);
    while (hi > lo && SUFFIX_SET.has(parts[hi])) suffixes.unshift(parts[hi--]);

    return {
      original: parts.join(''),   // reconstructed without boundaries
      segmented: token,
      prefixes,
      stem: parts.slice(lo, hi + 1).join('+'),
      suffixes,
    };
  });
}

function parsePOS(raw: string): PosToken[] {
  return raw.trim().split(/\s+/).map(token => {
    const lastSlash = token.lastIndexOf('/');
    if (lastSlash === -1) return { word: token, tag: '?', label: 'Unknown' };
    const word = token.slice(0, lastSlash);
    const tag  = token.slice(lastSlash + 1);
    return { word, tag, label: POS_LABEL[tag] ?? tag };
  });
}

/**
 * Farasa NER output format: "word/B-PERS word/I-PERS word/O ..."
 * BIO encoding: B-TYPE = beginning of entity, I-TYPE = inside, O = outside.
 */
function parseNER(raw: string): NerResult {
  const tokens = raw.trim().split(/\s+/);
  const entities: NerEntity[] = [];
  let currentWords: string[] = [];
  let currentType = '';

  const flush = () => {
    if (currentWords.length > 0 && currentType) {
      entities.push({
        text: currentWords.join(' '),
        type: currentType,
        typeLabel: NER_LABEL[currentType] ?? currentType,
      });
    }
    currentWords = [];
    currentType = '';
  };

  for (const token of tokens) {
    const slash = token.lastIndexOf('/');
    if (slash === -1) continue;
    const word = token.slice(0, slash);
    const tag  = token.slice(slash + 1);

    if (tag === 'O') {
      flush();
    } else if (tag.startsWith('B-')) {
      flush();
      currentType = tag.slice(2);
      currentWords = [word];
    } else if (tag.startsWith('I-') && tag.slice(2) === currentType) {
      currentWords.push(word);
    } else {
      flush();
    }
  }
  flush();

  return { entities, raw };
}

/**
 * Farasa parsing output is CoNLL format, one token per line:
 * INDEX WORD LEMMA POS _ _ HEAD RELATION _ _
 * (tab-separated, 10 columns)
 */
function parseDependency(raw: string): DepToken[] {
  const tokens: DepToken[] = [];
  for (const line of raw.trim().split('\n')) {
    const cols = line.trim().split(/\t+/);
    if (cols.length < 8) continue;
    const index    = parseInt(cols[0], 10);
    const word     = cols[1] ?? '';
    const lemma    = cols[2] ?? undefined;
    const pos      = cols[3] ?? undefined;
    const head     = parseInt(cols[6], 10);
    const relation = cols[7] ?? '';
    if (isNaN(index)) continue;
    tokens.push({
      index,
      word,
      lemma: lemma !== '_' ? lemma : undefined,
      pos: pos !== '_' ? pos : undefined,
      head,
      relation,
      relationLabel: DEP_LABEL[relation] ?? relation,
    });
  }
  return tokens;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Requires a signed-in user; blocks anonymous abuse of the external NLP API.
  const cap = await enforceDailyCap(req, 'farasa', 200, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const body = await req.json();
    const { text, tasks } = body as { text: string; tasks?: FarasaTask[] };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const requestedTasks: FarasaTask[] = Array.isArray(tasks) && tasks.length > 0
      ? tasks.filter((t): t is FarasaTask => ['diac', 'seg', 'pos', 'NER', 'parsing'].includes(t))
      : ['diac'];

    if (requestedTasks.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid tasks requested. Valid: diac, seg, pos, NER, parsing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const clean = text.trim();
    console.log(`farasa: text="${clean.slice(0, 60)}" tasks=[${requestedTasks.join(',')}]`);

    // Run all requested tasks in parallel
    const rawResults = await Promise.all(
      requestedTasks.map(task => callFarasa(task, clean).then(outcome => ({ task, outcome }))),
    );

    // Build structured response
    const result: Record<string, unknown> = { inputText: clean, tasks: requestedTasks };
    const failures: Partial<Record<FarasaTask, FarasaFailureReason>> = {};

    for (const { task, outcome } of rawResults) {
      if (!outcome.ok) {
        result[task] = null;
        result[`${task}Available`] = false;
        // Callers need to distinguish "Farasa is down" from "the key was
        // rejected" — only one of those is worth retrying.
        result[`${task}Error`] = outcome.reason;
        failures[task] = outcome.reason;
        console.warn(`farasa: ${task} unavailable — ${outcome.reason}`);
        continue;
      }
      const raw = outcome.text;

      result[`${task}Available`] = true;

      switch (task) {
        case 'diac':
          result.diac = { text: raw } satisfies DiacResult;
          break;

        case 'seg':
          result.seg = {
            raw,
            tokens: parseSegmentation(raw),
          };
          break;

        case 'pos':
          result.pos = {
            raw,
            tokens: parsePOS(raw),
          };
          break;

        case 'NER':
          result.NER = parseNER(raw);
          break;

        case 'parsing':
          result.parsing = {
            raw,
            tokens: parseDependency(raw),
          };
          break;
      }
    }

    const failedTasks = Object.keys(failures) as FarasaTask[];
    if (failedTasks.length > 0) {
      result.errors = failures;
      if (failedTasks.every((t) => failures[t] === 'invalid_api_key')) {
        result.configHint = 'FARASA_API_KEY is missing or rejected — register at farasa.qcri.org';
      }
    }

    console.log(
      `farasa: complete — tasks=${requestedTasks.join(',')}` +
        (failedTasks.length ? ` | failed=${failedTasks.map(t => `${t}:${failures[t]}`).join(',')}` : ''),
    );
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('farasa error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
