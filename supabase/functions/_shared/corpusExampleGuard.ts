// Screening for examples quoted out of a mined corpus.
//
// mine-dialect-corpus asks the council to cite forms that appear verbatim in
// the corpus sample, and writes them to dialect_rules.examples. Those examples
// do not stay server-side: harvestForbiddenTokens and getDialectFewShot in
// dialectHelpers.ts fold them into EVERY generator prompt, and the Dialect
// Rulebook UI renders them to admins. So a rule example is a short path from
// raw source text to learner-facing content.
//
// That path has always existed for the six platform sources. It matters more
// now that real scraped text is in scope: the Lisan Yemeni corpus is wartime
// Twitter, where ~57% of sentences are political by its own derivation's
// measure, and keyword filtering demonstrably does not clean it -- 38% of the
// sentences it marked non-political still hit an extended slur list, and
// hand-reading the survivors still finds factional slurs and obscenity.
//
// The response here is to bound the OUTPUT rather than trust the input. A rule
// may say "use ما before the verb" and cite ما عاد; it may not carry a whole
// tweet. Two independent limits, because they fail differently: a length cap
// catches wholesale copying regardless of content, and a term screen catches
// short-but-toxic citations that the cap would let through.

import { normalizeArabic } from './msaLeakDetector.ts';

/** A dialect rule example is a form or a short pattern, never a sentence. */
export const MAX_EXAMPLE_WORDS = 4;

/** Belt-and-braces alongside the word cap: no unbroken wall of text. */
export const MAX_EXAMPLE_CHARS = 60;

// Substring-matched against the NORMALIZED example. Deliberately short stems so
// inflections are caught: عفاش alone misses العفافيش, which is exactly how the
// derivation's own stop-list let that slur through.
//
// This screens rule examples only -- it is not a content filter for learner
// text, and it is not trying to be exhaustive. A dropped example costs the rule
// one citation; the council can cite something else.
//
// Note what is NOT here: قات، مفرج، جنبيه، سلته and the rest of the cultural
// vocabulary. Those are legitimate Yemeni content and appear in the seeded
// rulebook's own cultural_references row.
const SCREENED_STEMS = [
  // factional / sectarian labels and slurs seen in the corpus sample
  'حوث', 'عفاش', 'عفافيش', 'دحباش', 'دنبوع', 'زينبي', 'مليشيا', 'مرتزق',
  'خائن', 'خونه', 'عميل', 'ضالعي',
  // war vocabulary -- a dialect rule never needs to cite these
  'قصف', 'صاروخ', 'شهيد', 'ارهاب', 'اغتيال', 'مقبره', 'جبهه', 'جبهات',
  // coarse terms
  'معفن', 'وصخ', 'قبحك', 'لعنه', 'حشيش',
].map(normalizeArabic);

export interface ScreenResult {
  ok: boolean;
  reason?: 'too_many_words' | 'too_long' | 'screened_term';
  detail?: string;
}

/** Whether a single example may be quoted into a rule. */
export function screenExample(raw: unknown): ScreenResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'screened_term', detail: 'not a string' };
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'screened_term', detail: 'empty' };

  if (text.length > MAX_EXAMPLE_CHARS) {
    return { ok: false, reason: 'too_long', detail: `${text.length} chars` };
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > MAX_EXAMPLE_WORDS) {
    return { ok: false, reason: 'too_many_words', detail: `${words.length} words` };
  }

  const norm = normalizeArabic(text);
  for (const stem of SCREENED_STEMS) {
    if (stem && norm.includes(stem)) {
      return { ok: false, reason: 'screened_term', detail: stem };
    }
  }
  return { ok: true };
}

export interface GuardedExamples {
  good: string[];
  bad: string[];
  dropped: Array<{ text: string; reason: string }>;
}

/**
 * Screen both example arrays. Non-string entries are dropped: the msa/dialect
 * object form used by hand-authored msa_substitutions rows is not something the
 * council emits, and letting objects through unscreened would be a hole.
 */
export function guardExamples(examples: unknown): GuardedExamples {
  const src = (examples ?? {}) as { good?: unknown; bad?: unknown };
  const dropped: GuardedExamples['dropped'] = [];

  const keep = (list: unknown): string[] => {
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const item of list) {
      const verdict = screenExample(item);
      if (verdict.ok) {
        out.push((item as string).trim());
      } else {
        dropped.push({
          text: typeof item === 'string' ? item.slice(0, 120) : String(item),
          reason: `${verdict.reason}${verdict.detail ? `: ${verdict.detail}` : ''}`,
        });
      }
    }
    return out;
  };

  return { good: keep(src.good), bad: keep(src.bad), dropped };
}

/**
 * A rule with no surviving good example has lost the thing that made it
 * corpus-grounded, so it is not worth proposing. The caller drops it.
 */
export function isProposalUsable(guarded: GuardedExamples): boolean {
  return guarded.good.length > 0;
}
