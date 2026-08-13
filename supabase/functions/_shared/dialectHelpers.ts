// Shared dialect identity helpers for edge functions
//
// Rules now live in the `dialect_rules` Postgres table (the Dialect Rulebook).
// At runtime we load approved rules into an in-memory cache (5 min TTL) and
// expose:
//   - identity prompt block (highest-priority "identity" rule)
//   - vocab/rules prompt block (other rules rendered as bullet lines)
//   - few-shot examples block (✅/❌ pairs from rule examples)
//   - forbidden tokens list (every string in examples.bad) for the MSA detector
//
// Call `primeDialectPrompt(dialect)` at the top of an edge function to warm
// the cache. All sync getters fall back to the hard-coded strings on cache miss.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { ALWAYS_ALLOWED, normalizeArabic } from './msaLeakDetector.ts';

// Defined in dialectTypes.ts (import-free) and re-exported here so every
// existing `from './dialectHelpers.ts'` import keeps working unchanged.
import type { Dialect } from './dialectTypes.ts';
export type { Dialect } from './dialectTypes.ts';

// =================== Hard-coded fallback (parity with seed) ===================

const GULF_IDENTITY = `You are a native Gulf Arabic (Khaliji) speaker. Always respond in Gulf Arabic dialect, NOT Modern Standard Arabic (فصحى).
Use authentic Gulf vocabulary and expressions: شلونك، وين، هالحين، يالله، إن شاء الله، ليش، واجد، يبي، إمبي، شي، خوش، زين.
Cultural references should be Gulf-specific (مجلس، قهوة عربية، دلة، بخور).
Do NOT use Egyptian, Levantine, or Yemeni Arabic.`;

const EGYPTIAN_IDENTITY = `You are a native Egyptian Arabic (مصري) speaker. Always respond in Egyptian Arabic dialect, NOT Modern Standard Arabic (فصحى).
Use authentic Egyptian vocabulary and expressions: إزيك، فين، دلوقتي، عايز، كويس، ماشي، يلا، حاضر، بتاع، مفيش، ازاي، كده، خلاص، يعني، طيب.
Cultural references should be Egyptian-specific (أهوة، كشري، فول، طعمية، نيل، خان الخليلي).
Do NOT use Gulf, Levantine, or Yemeni Arabic.`;

const YEMENI_IDENTITY = `You are a native Yemeni Arabic (يمني) speaker. Always respond in Yemeni Arabic dialect, NOT Modern Standard Arabic (فصحى).
Use authentic Yemeni vocabulary and expressions: كيف حالك (but Yemeni pronunciation), وين، ذحين/الحين، ليش، بغيت، زين، أيوه، طيب، هيا، شو، ما عندي، قات، مبسوط.
Cultural references should be Yemeni-specific (قات، مفرج، جنبية، سلتة، بنت الصحن، صنعاء القديمة، مأرب، عدن).
Do NOT use Gulf, Egyptian, or Levantine Arabic.`;

const GULF_VOCAB_RULES = `CRITICAL DIALECT RULES:
- Always use Gulf Arabic (Khaliji) vocabulary and expressions, NEVER Modern Standard Arabic (فصحى).
- Use dialectal forms: شلونك (not كيف حالك), وين (not أين), هالحين (not الآن), ليش (not لماذا), واجد (not كثير), يبي (not يريد), إمبي (not أريد), شي (not شيء).
- Arabic script must reflect Gulf pronunciation and spelling conventions.
- Cultural references should be Gulf-specific (مجلس، قهوة عربية، دلة، بخور).`;

const EGYPTIAN_VOCAB_RULES = `CRITICAL DIALECT RULES:
- Always use Egyptian Arabic (مصري) vocabulary and expressions, NEVER Modern Standard Arabic (فصحى).
- Use dialectal forms: إزيك (not كيف حالك), فين (not أين), دلوقتي (not الآن), ليه (not لماذا), كتير (not كثير), عايز (not يريد), عاوز/عاوزة, مش (not ليس), ده/دي (not هذا/هذه).
- Arabic script must reflect Egyptian pronunciation and spelling conventions.
- Cultural references should be Egyptian-specific (أهوة، كشري، فول، طعمية).`;

const YEMENI_VOCAB_RULES = `CRITICAL DIALECT RULES:
- Always use Yemeni Arabic (يمني) vocabulary and expressions, NEVER Modern Standard Arabic (فصحى).
- Use dialectal forms: كيفك/كيف حالك (Yemeni pronunciation), وين (not أين), ذحين/الحين (not الآن), ليش (not لماذا), بغيت (not أريد), ما عندي (not ليس لدي), شو (not ماذا), هيّا (not هيا بنا).
- Arabic script must reflect Yemeni pronunciation and spelling conventions (e.g., heavy use of ق as 'g' in some regions).
- Cultural references should be Yemeni-specific (قات، مفرج، جنبية، سلتة، بنت الصحن، فحسة).`;

function fallbackIdentity(d: Dialect): string {
  if (d === 'Egyptian') return EGYPTIAN_IDENTITY;
  if (d === 'Yemeni') return YEMENI_IDENTITY;
  return GULF_IDENTITY;
}
function fallbackVocab(d: Dialect): string {
  if (d === 'Egyptian') return EGYPTIAN_VOCAB_RULES;
  if (d === 'Yemeni') return YEMENI_VOCAB_RULES;
  return GULF_VOCAB_RULES;
}

// =================== Rulebook cache ===================

interface DialectRule {
  id?: string;
  category: string;
  rule: string;
  examples: { good?: unknown[]; bad?: unknown[] };
  priority: number;
}

export interface ForbiddenToken {
  token: string;
  rule_id?: string;
}

interface RenderedPrompt {
  identity: string;
  vocabRules: string;
  fewShot: string;
  forbiddenTokens: ForbiddenToken[];
  rulesCount: number;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, RenderedPrompt>();
const inflight = new Map<string, Promise<void>>();

function asString(item: unknown): string | null {
  if (typeof item === 'string') return item.trim() || null;
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    if (typeof o.dialect === 'string') return o.dialect.trim() || null;
    if (typeof o.ar === 'string') return o.ar.trim() || null;
    if (typeof o.text === 'string') return o.text.trim() || null;
  }
  return null;
}

function renderExamples(examples: DialectRule['examples']): string {
  const good = Array.isArray(examples?.good) ? examples.good : [];
  const bad = Array.isArray(examples?.bad) ? examples.bad : [];
  const fmt = (item: unknown): string => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      if (o.msa && o.dialect) return `${o.msa} → ${o.dialect}`;
      if (o.ar && o.en) return `${o.ar} (${o.en})`;
    }
    return JSON.stringify(item);
  };
  const parts: string[] = [];
  if (good.length) parts.push(`USE: ${good.map(fmt).join('، ')}`);
  if (bad.length) parts.push(`AVOID (MSA): ${bad.map(fmt).join('، ')}`);
  return parts.join(' | ');
}

function renderFewShot(rules: DialectRule[]): string {
  // Pick up to 6 highest-priority rules that have at least one good or bad example.
  const picks = rules
    .filter((r) => {
      const g = Array.isArray(r.examples?.good) && r.examples.good!.length > 0;
      const b = Array.isArray(r.examples?.bad) && r.examples.bad!.length > 0;
      return g || b;
    })
    .slice(0, 6);
  if (!picks.length) return '';
  const lines: string[] = ['AUTHENTIC PATTERNS (follow these):'];
  for (const r of picks) {
    const good = (Array.isArray(r.examples?.good) ? r.examples.good : [])
      .map(asString).filter(Boolean) as string[];
    const bad = (Array.isArray(r.examples?.bad) ? r.examples.bad : [])
      .map(asString).filter(Boolean) as string[];
    if (good[0] && bad[0]) {
      lines.push(`  ❌ ${bad[0]}   →   ✅ ${good[0]}   (${r.category})`);
    } else if (good[0]) {
      lines.push(`  ✅ ${good[0]}   (${r.category})`);
    } else if (bad[0]) {
      lines.push(`  ❌ NEVER: ${bad[0]}   (${r.category})`);
    }
  }
  return lines.join('\n');
}

function harvestForbiddenTokens(rules: DialectRule[], dialect: Dialect): ForbiddenToken[] {
  // Important: we do NOT split multi-word bad examples into individual
  // tokens. Splitting a contrastive MSA sentence like "كيف حالك" or
  // "البيت الذي بجانب المسجد كبير" would poison the detector with neutral
  // words. Multi-word phrases are still matched as whole phrases; single
  // tokens become forbidden tokens. Tokens in the per-dialect
  // ALWAYS_ALLOWED whitelist are dropped defensively.
  const allowed = ALWAYS_ALLOWED[dialect] ?? new Set<string>();
  const out = new Map<string, string | undefined>();
  for (const r of rules) {
    const bad = Array.isArray(r.examples?.bad) ? r.examples.bad : [];
    for (const item of bad) {
      const s = asString(item);
      if (!s) continue;
      const cleaned = s.replace(/^[\p{P}]+|[\p{P}]+$/gu, '').trim();
      if (!cleaned) continue;
      if (!/[\u0600-\u06FF]/.test(cleaned)) continue;
      if (cleaned.length < 2) continue;
      // Skip if this token (normalized) is in the always-allowed whitelist —
      // guards against admins pasting neutral words as bad examples.
      if (allowed.has(normalizeArabic(cleaned))) continue;
      if (!out.has(cleaned)) out.set(cleaned, r.id);
    }
  }
  return [...out.entries()].map(([token, rule_id]) => ({ token, rule_id }));
}

function renderPrompt(dialect: Dialect, rules: DialectRule[]): RenderedPrompt {
  const identityRule = rules.find((r) => r.category === 'identity') ?? rules[0];
  const identity = identityRule?.rule ?? fallbackIdentity(dialect);

  const others = rules.filter((r) => r !== identityRule);
  const lines: string[] = ['CRITICAL DIALECT RULES:'];
  for (const r of others) {
    const ex = renderExamples(r.examples);
    lines.push(`- [${r.category}] ${r.rule}${ex ? ` — ${ex}` : ''}`);
  }
  const vocabRules = others.length ? lines.join('\n') : fallbackVocab(dialect);
  const fewShot = renderFewShot(rules);
  const forbiddenTokens = harvestForbiddenTokens(rules, dialect);

  return {
    identity,
    vocabRules,
    fewShot,
    forbiddenTokens,
    rulesCount: rules.length,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

async function fetchRules(dialect: Dialect): Promise<DialectRule[]> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return [];
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from('dialect_rules')
    .select('id, category, rule, examples, priority')
    .eq('dialect', dialect)
    .eq('status', 'approved')
    .order('priority', { ascending: false })
    .order('category');
  if (error || !data) return [];
  return data as DialectRule[];
}

export async function primeDialectPrompt(dialect: Dialect): Promise<void> {
  const existing = cache.get(dialect);
  if (existing && existing.expiresAt > Date.now()) return;
  const pending = inflight.get(dialect);
  if (pending) return pending;
  const p = (async () => {
    try {
      const rules = await fetchRules(dialect);
      if (rules.length) cache.set(dialect, renderPrompt(dialect, rules));
    } catch (e) {
      console.warn('[dialectHelpers] primeDialectPrompt failed', dialect, e);
    } finally {
      inflight.delete(dialect);
    }
  })();
  inflight.set(dialect, p);
  return p;
}

// =================== Public sync API ===================

export function getDialectIdentity(dialect: Dialect): string {
  const c = cache.get(dialect);
  if (c && c.expiresAt > Date.now()) return c.identity;
  return fallbackIdentity(dialect);
}

export function getDialectVocabRules(dialect: Dialect): string {
  const c = cache.get(dialect);
  if (c && c.expiresAt > Date.now()) {
    return c.fewShot ? `${c.vocabRules}\n\n${c.fewShot}` : c.vocabRules;
  }
  return fallbackVocab(dialect);
}

export function getDialectFewShot(dialect: Dialect): string {
  const c = cache.get(dialect);
  return c && c.expiresAt > Date.now() ? c.fewShot : '';
}

export function getDialectForbiddenTokens(dialect: Dialect): ForbiddenToken[] {
  const c = cache.get(dialect);
  return c && c.expiresAt > Date.now() ? c.forbiddenTokens : [];
}

export function getDialectRulesCount(dialect: Dialect): number {
  const c = cache.get(dialect);
  return c && c.expiresAt > Date.now() ? c.rulesCount : 0;
}

export function getDialectLabel(dialect: Dialect): string {
  if (dialect === 'Egyptian') return 'Egyptian Arabic (مصري)';
  if (dialect === 'Yemeni') return 'Yemeni Arabic (يمني)';
  return 'Gulf Arabic (Khaliji)';
}

export function getDialectExamples(dialect: Dialect): string {
  if (dialect === 'Egyptian') {
    return 'إزيك (hello), شكراً (thanks), كويس (good), مية (water), بيت (house)';
  }
  if (dialect === 'Yemeni') {
    return 'كيفك (hello), شكراً (thanks), زين (good), ماء (water), بيت (house)';
  }
  return 'مرحبا (hello), شكراً (thanks), شلونك (how are you), ماي (water), بيت (house)';
}

// =================== Tashkeel validation ===================

// The implementation moved to passageQualityCore.ts, which is import-free so it
// can be unit-tested from the frontend Vitest suite. Re-exported here so the
// existing callers keep their import path.
export { measureTashkeelCoverage } from './passageQualityCore.ts';

// =================== Transliteration rules ===================

const TRANSLITERATION_RULES: Record<string, string> = {
  Gulf: `TRANSLITERATION RULES (Gulf Arabic):
- ق → g (qaaf is pronounced as hard "g" in Gulf)
- ج → y (jiim is pronounced as "y" in most Gulf dialects)
- ك → ch (kaaf is pronounced "ch" before front vowels in Kuwait/parts of Gulf)
- Use "kh" for خ, "gh" for غ, "sh" for ش, "th" for ث, "dh" for ذ
- Emphatic consonants: ص→S, ض→D, ط→T, ظ→DH (or capitalize)
- ع → 3 or ' (ayn), ء → 2 or ' (hamza)
- Long vowels: aa, ee/ii, oo/uu`,
  Egyptian: `TRANSLITERATION RULES (Egyptian Arabic):
- ق → ' (glottal stop in Cairo) or q (in Upper Egypt/formal)
- ج → g (jiim is always hard "g" in Egyptian)
- ث → s (not "th"), ذ → z (not "dh") in colloquial Egyptian
- Use "kh" for خ, "gh" for غ, "sh" for ش
- Emphatic consonants: ص→S, ض→D, ط→T, ظ→Z (or capitalize)
- ع → 3 or ' (ayn), ء → 2 or ' (hamza)
- Long vowels: aa, ee/ii, oo/uu`,
  Yemeni: `TRANSLITERATION RULES (Yemeni Arabic):
- ق → g (qaaf is pronounced as hard "g" in many Yemeni regions)
- ج → j (jiim is standard "j" in Yemeni)
- ث → th, ذ → dh (Yemeni preserves classical interdentals)
- Use "kh" for خ, "gh" for غ, "sh" for ش
- Emphatic consonants: ص→S, ض→D, ط→T, ظ→DH (or capitalize)
- ع → 3 or ' (ayn), ء → 2 or ' (hamza)
- Long vowels: aa, ee/ii, oo/uu`,
};

export function getDialectTransliterationRules(dialect: Dialect): string {
  return TRANSLITERATION_RULES[dialect] ?? TRANSLITERATION_RULES.Gulf;
}

// =================== Tashkeel mandate (shared prompt block) ===================

/**
 * Reusable "fully vocalize every Arabic line" instruction block, proven in
 * generate-listen-script. Un-vocalized Arabic causes mispronunciation when
 * read aloud by TTS, so any generator whose output gets voiced (or shown as
 * a reading target) should include this in its system prompt.
 */
export function getTashkeelMandate(): string {
  return `TASHKEEL (CRITICAL FOR TTS PRONUNCIATION):
- Every Arabic sentence/line MUST be FULLY VOCALIZED with tashkeel (fatha, kasra, damma, sukun, shadda, tanween) on every consonant where a vowel applies.
- Example: write "مَرْحَبًا يَا جَمَاعَة" — NOT "مرحبا يا جماعة".
- This is mandatory so the TTS engine pronounces dialect words correctly. Missing tashkeel = wrong pronunciation.
- Apply tashkeel to the dialect spellings (do NOT force MSA forms just to add diacritics).`;
}
