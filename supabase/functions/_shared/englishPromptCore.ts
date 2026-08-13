// English-target prompt rendering — the pure half of englishHelpers.ts.
//
// Import-free by design (same pattern as learnerProfileCore.ts /
// passageQualityCore.ts) so the frontend Vitest suite can unit-test the
// rendering and pattern-harvesting logic directly.
//
// This is the mirror image of dialectHelpers' rulebook rendering: where
// Hakiya conditioned generation on "be authentic dialect, never MSA",
// Ingleezy conditions on "be natural English, and teach deliberately
// against the documented Arabic→English transfer errors".

export interface InterferenceRule {
  id?: string;
  /** null/undefined = applies to speakers of every Arabic dialect. */
  dialect?: string | null;
  category: string;
  rule: string;
  explanation_ar?: string | null;
  examples: { good?: unknown[]; bad?: unknown[] };
  priority: number;
}

/** A deterministically matchable Arabic-shaped-English pattern. */
export interface TransferPattern {
  pattern: string;
  category: string;
  rule_id?: string;
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// Fallback rulebook — parity with the 20260813150000_interference_rules seed.
// Used when the DB cache is cold, and as the transfer detector's built-in
// pattern source. Keep in sync with the migration when rules change.
// ---------------------------------------------------------------------------

export const FALLBACK_INTERFERENCE_RULES: InterferenceRule[] = [
  {
    category: 'article',
    rule: 'Arabic has no indefinite article, so learners drop a/an. Every singular countable noun needs one.',
    examples: {
      bad: ['I am student', 'She is teacher', 'He works as engineer'],
      good: ['I am a student', 'She is a teacher', 'He works as an engineer'],
    },
    priority: 5,
  },
  {
    category: 'article',
    rule: 'Arabic uses ال with generic and abstract nouns; English drops "the" for them.',
    examples: {
      bad: ['The life is beautiful', 'I love the music', 'The patience is important'],
      good: ['Life is beautiful', 'I love music', 'Patience is important'],
    },
    priority: 4,
  },
  {
    category: 'copula',
    rule: 'Arabic nominal sentences have no present-tense "to be"; learners omit is/am/are.',
    examples: {
      bad: ['The report ready', 'She happy', 'Where the bathroom?'],
      good: ['The report is ready', 'She is happy', 'Where is the bathroom?'],
    },
    priority: 5,
  },
  {
    category: 'phonology',
    rule: 'Arabic has no /p/; learners produce /b/ instead. Drill aspirated /p/ minimal pairs.',
    examples: {
      bad: ['beoble', 'bicture', 'barty', 'bark the car'],
      good: ['people', 'picture', 'party', 'park the car'],
    },
    priority: 5,
  },
  {
    category: 'phonology',
    rule: 'Arabic syllable structure avoids initial consonant clusters; learners insert a helping vowel.',
    examples: { bad: ['isport', 'sipring', 'istreet'], good: ['sport', 'spring', 'street'] },
    priority: 4,
  },
  {
    category: 'phonology',
    rule: 'Learners devoice /v/ to /f/ (Arabic has ف but no /v/).',
    examples: { bad: ['fery good', 'fillage', 'haf to go'], good: ['very good', 'village', 'have to go'] },
    priority: 3,
  },
  {
    category: 'preposition',
    rule: 'Arabic preposition choices transfer literally: married from (متزوج من), afraid from (خائف من), angry from.',
    examples: {
      bad: ['married from', 'afraid from', 'angry from him', 'listen music'],
      good: ['married to', 'afraid of', 'angry with him', 'listen to music'],
    },
    priority: 4,
  },
  {
    category: 'calque',
    rule: 'Arabic idioms translated word-for-word produce unnatural English.',
    examples: {
      bad: ['open the light', 'close the light', 'close the phone', 'cut the street'],
      good: ['turn on the light', 'turn off the light', 'hang up the phone', 'cross the street'],
    },
    priority: 4,
  },
  {
    category: 'word_order',
    rule: 'Arabic adjectives follow the noun; English adjectives precede it.',
    examples: { bad: ['a car big', 'a house beautiful'], good: ['a big car', 'a beautiful house'] },
    priority: 3,
  },
  {
    category: 'morphology',
    rule: 'Third-person singular -s is dropped (Arabic marks person on the verb differently).',
    examples: { bad: ['he go', 'she like', 'it work'], good: ['he goes', 'she likes', 'it works'] },
    priority: 4,
  },
  {
    category: 'morphology',
    rule: 'Arabic relative clauses keep a resumptive pronoun (اللي شفته); English drops it.',
    examples: {
      bad: ['the book which I read it', 'the man who I saw him'],
      good: ['the book which I read', 'the man who I saw'],
    },
    priority: 3,
  },
  {
    category: 'spelling',
    rule: 'The /p/-/b/ confusion carries into spelling.',
    examples: { bad: ['broblem', 'bicnic', 'beper'], good: ['problem', 'picnic', 'pepper'] },
    priority: 3,
  },
];

// ---------------------------------------------------------------------------
// Identity block
// ---------------------------------------------------------------------------

const CEFR_GUIDANCE: Record<string, string> = {
  A1: 'Use only high-frequency vocabulary and short simple sentences (present tense, basic questions). One idea per sentence.',
  A2: 'Use everyday vocabulary and simple connected sentences (and/but/because). Past and future are fine; avoid idioms.',
  B1: 'Use natural everyday English with common phrasal verbs and connectors. Occasional idioms are fine if guessable from context.',
  B2: 'Use fluent natural English including idioms, phrasal verbs, and varied sentence structure.',
  C1: 'Use sophisticated natural English without simplification; include register variation and nuance.',
};

/**
 * The English-target identity block: the mirror of getDialectIdentity.
 * Natural spoken English is the product — the same way "authentic dialect,
 * never MSA" was Hakiya's product. Textbook-stiff English is this app's
 * equivalent of an MSA leak.
 */
export function renderEnglishIdentity(cefr?: string): string {
  const level = cefr && CEFR_GUIDANCE[cefr]
    ? `\nLEARNER LEVEL (CEFR ${cefr}): ${CEFR_GUIDANCE[cefr]}`
    : '';
  return `You are a native English speaker creating content for Arabic speakers learning English.
Always use natural, contemporary, SPOKEN English — the way people actually talk — not stiff textbook English.
Contractions (I'm, don't, can't) are normal spoken English; use them.
Any Arabic you write (translations, explanations) must be in the learner's own dialect unless Fusha is explicitly requested.${level}`;
}

// ---------------------------------------------------------------------------
// Interference guidance block
// ---------------------------------------------------------------------------

function firstString(items: unknown[] | undefined): string | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return null;
}

/**
 * Render approved rules as the "teach against these" block. Included in the
 * system prompt of every English-target generation so drills, examples and
 * corrections deliberately exercise the errors Arabic speakers actually make.
 */
export function renderInterferenceGuidance(rules: InterferenceRule[]): string {
  if (!rules.length) return '';
  const lines: string[] = [
    'COMMON ARABIC-SPEAKER ERRORS (design content that teaches against these; when correcting a learner, name the pattern):',
  ];
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    const bad = firstString(r.examples?.bad);
    const good = firstString(r.examples?.good);
    const example = bad && good ? ` — ❌ "${bad}" → ✅ "${good}"` : '';
    lines.push(`- [${r.category}] ${r.rule}${example}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Transfer-pattern harvesting (for the deterministic detector)
// ---------------------------------------------------------------------------

/**
 * Categories whose bad examples are lexically matchable: the phrase itself is
 * wrong in (almost) any context. Grammar-shaped categories (copula, article,
 * word_order, morphology) are NOT harvested — "he go" is an error in "he go
 * home" but innocent inside "where did he go", so those patterns need
 * context-aware (AI) grading, not string matching.
 */
export const MATCHABLE_CATEGORIES = new Set(['calque', 'preposition', 'spelling']);

const MAX_PATTERN_WORDS = 5;

/** True when a bad example is safe to match deterministically. */
export function isMatchablePattern(text: string, category: string): boolean {
  if (!MATCHABLE_CATEGORIES.has(category)) return false;
  const t = text.trim();
  if (!t) return false;
  // ASCII letters, spaces and apostrophes only — an Arabic or mixed example
  // is contrastive documentation, not a matchable English string.
  if (!/^[A-Za-z][A-Za-z' ]*$/.test(t)) return false;
  if (t.split(/\s+/).length > MAX_PATTERN_WORDS) return false;
  return true;
}

/**
 * Harvest deterministically matchable patterns from rulebook rows. The good
 * example at the same index becomes the suggestion, mirroring how the seed
 * data aligns its arrays.
 */
export function harvestTransferPatterns(rules: InterferenceRule[]): TransferPattern[] {
  const out: TransferPattern[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    const bad = Array.isArray(r.examples?.bad) ? r.examples.bad : [];
    const good = Array.isArray(r.examples?.good) ? r.examples.good : [];
    bad.forEach((item, i) => {
      if (typeof item !== 'string') return;
      const pattern = item.trim().toLowerCase();
      if (!isMatchablePattern(pattern, r.category) || seen.has(pattern)) return;
      seen.add(pattern);
      const suggestion = typeof good[i] === 'string' ? (good[i] as string).trim() : undefined;
      out.push({ pattern, category: r.category, rule_id: r.id, suggestion });
    });
  }
  return out;
}
