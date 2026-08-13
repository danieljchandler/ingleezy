// MSA (Modern Standard Arabic) leak detector.
// Combines a hardcoded universal/cross-dialect list with rulebook-derived
// forbidden tokens harvested from approved dialect_rules.examples.bad
// (see primeDialectPrompt in dialectHelpers.ts).
//
// All matching is performed on Arabic-normalized text so spelling variants
// (alef/ya/ta-marbuta, tashkeel) don't cause false negatives or false
// positives. Each dialect also has an ALWAYS_ALLOWED whitelist of words that
// are valid in that dialect and must NEVER be flagged as MSA leaks — this
// guards against admins pasting full MSA sentences as bad examples and
// poisoning the detector with neutral words.

import type { Dialect } from './dialectTypes.ts';

// ---------- Arabic normalization ----------

const TASHKEEL_RE = /[\u064B-\u065F\u0670\u0640]/g; // diacritics + tatweel

/** Normalize Arabic so spelling variants compare equal. Exported for reuse. */
export function normalizeArabic(s: string): string {
  if (!s) return '';
  return s
    .replace(TASHKEEL_RE, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627') // أ إ آ → ا
    .replace(/\u0649/g, '\u064A')               // ى → ي
    .replace(/\u0629/g, '\u0647')               // ة → ه
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Hardcoded leak lists ----------
//
// Each list contains forms that are unambiguously WRONG for the target
// dialect (i.e. they belong to a different dialect or pure MSA). Anything
// borderline lives in the rulebook, not here.

const UNIVERSAL_MSA_LEAKS = [
  'الآن', 'لماذا', 'هذا', 'هذه', 'هؤلاء', 'ذلك',
  'سوف', 'ليس', 'لست', 'ليسوا',
  'الذي', 'التي', 'الذين',
  'عندما', 'حينما', 'بينما', 'أيضاً', 'أيضًا', 'كذلك',
];

// Per-dialect EXTRAS: forms that are wrong for THIS dialect because they
// belong to another dialect (e.g. Egyptian-only tokens shouldn't appear in
// Gulf/Yemeni text). Reviewed and audited 2026-06; do NOT add words that
// are legitimately used in the target dialect.
const DIALECT_EXTRA: Record<string, string[]> = {
  // Egyptian-only forms should not appear in Gulf text.
  Gulf: ['إزيك', 'إزاي', 'دلوقتي', 'عايز', 'عاوز', 'كده', 'مفيش', 'النهاردة', 'ازاي'],
  // Gulf and Yemeni-only forms should not appear in Egyptian text.
  Egyptian: ['شلونك', 'هالحين', 'واجد', 'يبي', 'إمبي', 'زين', 'خوش', 'بغيت', 'ذحين', 'شخبارك', 'شخبارش', 'وين', 'ذلحين'],
  // Egyptian-only + classic Gulf-only forms should not appear in Yemeni text.
  // NOTE: شلون/وش/زين/أبي/شفيك/يبغى/أبغى/لاحين are valid Yemeni and were
  // removed from this list on 2026-06.
  Yemeni: ['إزيك', 'دلوقتي', 'عايز', 'عاوز', 'كده', 'مفيش', 'النهاردة', 'شخبارك', 'شخبارش', 'هالحين', 'خوش', 'ازاي', 'إزاي'],
};

// Per-dialect ALWAYS_ALLOWED: words that are valid in this dialect (or
// dialect-neutral) and must never be flagged, even if an admin accidentally
// pastes them inside a bad-example sentence. Exported for use by the
// harvester in dialectHelpers.ts and by the admin UI lint.
export const ALWAYS_ALLOWED: Record<string, Set<string>> = {
  Gulf: new Set([
    // pronouns / particles / common neutral words
    'انا', 'انت', 'انتي', 'انتو', 'احنا', 'هو', 'هي', 'هم',
    'من', 'في', 'ما', 'لي', 'لك', 'له', 'لها', 'معي', 'معك',
    'مع', 'الى', 'على', 'عن', 'الي',
    'اليوم', 'بكره', 'امس', 'البيت', 'بيت', 'الكتاب', 'كتاب',
    'السوق', 'القهوه', 'صديقي', 'حالك', 'حاله', 'كبير', 'صغير',
    'كيف', 'كيفك', 'وين', 'ليش', 'شلون', 'شلونك', 'شو', 'هالحين',
    'بغيت', 'ابي', 'يبي', 'زين', 'كويس', 'مرحبا', 'يلا', 'يالله',
    // Demonstratives and 'when'. These sit on UNIVERSAL_MSA_LEAKS, but Gulf
    // speakers use them freely, so every generated passage tripped the detector
    // and paid for a rewrite pass that could never clear them — the model kept
    // writing the same words because they were never wrong. Confirmed as
    // acceptable Gulf 2026-08. Egyptian keeps them flagged (ده/دي is the norm
    // there); Yemeni got the same review 2026-08 — see below.
    'هذا', 'هذه', 'عندما',
  ].map(normalizeArabic)),
  Egyptian: new Set([
    'انا', 'انت', 'انتي', 'انتو', 'احنا', 'هو', 'هي', 'هم',
    'من', 'في', 'ما', 'لي', 'لك', 'له', 'لها', 'معي', 'معك',
    'مع', 'الى', 'على', 'عن',
    'النهارده', 'بكره', 'امبارح', 'البيت', 'بيت', 'الكتاب', 'كتاب',
    'السوق', 'القهوه', 'صحبي', 'صاحبي', 'كبير', 'صغير',
    'كيف', 'ازاي', 'فين', 'ليه', 'كده', 'ده', 'دي', 'عايز', 'عاوز',
    'كويس', 'مرحبا', 'اهلا', 'حلو',
  ].map(normalizeArabic)),
  Yemeni: new Set([
    'انا', 'انت', 'انتي', 'انتو', 'احنا', 'هو', 'هي', 'هم',
    'من', 'في', 'ما', 'لي', 'لك', 'له', 'لها', 'معي', 'معك',
    'مع', 'الى', 'على', 'عن',
    'اليوم', 'بكره', 'امس', 'البيت', 'بيت', 'الكتاب', 'كتاب',
    'السوق', 'القهوه', 'صديقي', 'صاحبي', 'حالك', 'حاله', 'كبير', 'صغير',
    // genuinely Yemeni
    'كيف', 'كيفك', 'وين', 'ليش', 'ذحين', 'ذلحين', 'الحين', 'لاحين',
    'بغيت', 'يبغى', 'ابغى', 'ابي', 'اشتي', 'اشرب',
    'شلون', 'شلونك', 'شفيك', 'وش', 'زين', 'هني', 'مره',
    'قات', 'سلته', 'مفرج', 'جنبيه', 'شو', 'مرحبا', 'يلا',
    // Audited 2026-08 against the Lisan Yemeni corpus (docs/yemeni/), the same
    // review Gulf got. Counts below are from lexicon-full.json, ~801k tokens.
    //
    // Whitelisted: هذا (3,615 vs ذا 218) and هذه (1,625 vs ذي 209) — the MSA
    // form outnumbers the dialectal one 17:1 and 8:1, so flagging them bought
    // the same unclearable rewrite pass Gulf was paying. عندما (430) follows
    // Gulf's precedent; لما (713) is commoner but both are in real use, and a
    // rewrite is poor value for that.
    //
    // Deliberately NOT whitelisted, because the dialectal form genuinely wins
    // and the detector steering toward it is the behaviour we want:
    //   الذي 2,259 / التي 1,058  vs  اللي 4,406
    //   ماذا 258                 vs  ايش 1,067، وش 299
    //   ليس 732                  vs  مش 1,326، مو 665
    //   لماذا 364                vs  ليش 775
    //   الآن 1,241               vs  الحين 418، ذلحين 58
    'هذا', 'هذه', 'عندما',
    // Attested Yemeni forms, added so a rulebook bad-example can never harvest
    // them into the forbidden list (see harvestForbiddenTokens).
    'بس', 'اللي', 'مش', 'مو', 'عشان', 'ايش', 'حق',
    'شوي', 'لما', 'زي', 'طيب', 'عاد', 'ذا', 'ذي',
  ].map(normalizeArabic)),
};

export interface MsaLeakResult {
  leaks: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  /** token → rule_id (only present when leak matched a rulebook-derived token) */
  ruleHits?: Record<string, string>;
}

export interface ExtraToken {
  token: string;
  rule_id?: string;
}

export function detectMsaLeaks(
  text: string,
  dialect: Dialect,
  extraTokens: ExtraToken[] = [],
): MsaLeakResult {
  if (!text) return { leaks: [], severity: 'none' };
  const extra = DIALECT_EXTRA[dialect] ?? [];
  const allowed = ALWAYS_ALLOWED[dialect] ?? new Set<string>();

  // Strip quoted/example content so we don't false-positive on contrastive examples.
  const strippedRaw = text
    .replace(/[""«»][^""«»]*[""«»]/g, ' ')
    .replace(/\(not [^)]*\)/g, ' ')
    .replace(/\(بدل [^)]*\)/g, ' ')
    .replace(/❌[^\n✅]*/g, ' ')
    .replace(/AVOID[^\n]*/g, ' ');
  const stripped = normalizeArabic(strippedRaw);

  // Build candidate set with optional rule_id mapping. Keys are NORMALIZED.
  const candidates = new Map<string, { display: string; ruleId?: string }>();
  const add = (raw: string, ruleId?: string) => {
    const norm = normalizeArabic(raw);
    if (!norm) return;
    if (allowed.has(norm)) return; // never forbid an always-allowed token
    const existing = candidates.get(norm);
    if (!existing) candidates.set(norm, { display: raw, ruleId });
    else if (!existing.ruleId && ruleId) existing.ruleId = ruleId;
  };
  for (const w of UNIVERSAL_MSA_LEAKS) add(w);
  for (const w of extra) add(w);
  for (const { token, rule_id } of extraTokens) {
    if (token) add(String(token), rule_id);
  }

  const foundDisplay = new Map<string, string>(); // normKey -> display token
  const ruleHits: Record<string, string> = {};
  for (const [norm, info] of candidates) {
    const re = new RegExp(`(^|[\\s\\p{P}])${escapeRe(norm)}($|[\\s\\p{P}])`, 'u');
    if (re.test(stripped)) {
      foundDisplay.set(norm, info.display);
      if (info.ruleId) ruleHits[info.display] = info.ruleId;
    }
  }
  const leaks = [...foundDisplay.values()];
  let severity: MsaLeakResult['severity'] = 'none';
  if (leaks.length === 1) severity = 'low';
  else if (leaks.length === 2) severity = 'medium';
  else if (leaks.length >= 3) severity = 'high';
  return { leaks, severity, ruleHits: Object.keys(ruleHits).length ? ruleHits : undefined };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
