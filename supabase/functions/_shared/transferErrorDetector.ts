// Arabic→English transfer-error detector — the English-target mirror of
// msaLeakDetector.ts, with the same philosophy and the same limits.
//
// It is a lexical matcher: it catches known Arabic-shaped phrases (calques
// like "open the light", preposition transfer like "married from", spelling
// swaps like "broblem") that are wrong in essentially any context. It is
// deliberately blind to grammar-shaped errors — a missing copula or article
// depends on sentence structure, and string matching there would flag
// innocent text ("he go" inside "where did he go"). Those are graded by the
// AI passes; this detector is the cheap deterministic first line, used to
// tag learner output for the learner_errors flywheel and to sanity-check
// generated example sentences that are *supposed* to be correct English.
//
// Import-free (mirrors msaLeakDetector) so the Vitest suite tests it directly.

import {
  FALLBACK_INTERFERENCE_RULES,
  harvestTransferPatterns,
  type TransferPattern,
} from './englishPromptCore.ts';

export interface TransferError {
  /** The matched Arabic-shaped phrase, as found in the text. */
  match: string;
  category: string;
  /** Character offset of the match in the input text. */
  index: number;
  rule_id?: string;
  /** The natural-English form, when the rulebook pairs one. */
  suggestion?: string;
}

export interface TransferScanResult {
  errors: TransferError[];
  severity: 'none' | 'low' | 'medium' | 'high';
}

/** Built-in patterns, harvested from the fallback rulebook at module load. */
export const BUILTIN_TRANSFER_PATTERNS: TransferPattern[] =
  harvestTransferPatterns(FALLBACK_INTERFERENCE_RULES);

function severityFor(count: number): TransferScanResult['severity'] {
  if (count === 0) return 'none';
  if (count === 1) return 'low';
  if (count <= 3) return 'medium';
  return 'high';
}

const regexCache = new Map<string, RegExp>();

function patternRegex(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (!re) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    re = new RegExp(`\\b${escaped}\\b`, 'gi');
    regexCache.set(pattern, re);
  }
  return re;
}

/**
 * Scan English text for known transfer patterns. `extraPatterns` lets the
 * caller add rulebook-derived patterns from the DB cache (englishHelpers'
 * getTransferPatterns) on top of the built-ins.
 */
export function detectTransferErrors(
  text: string,
  extraPatterns: TransferPattern[] = [],
): TransferScanResult {
  if (!text || !/[A-Za-z]/.test(text)) return { errors: [], severity: 'none' };

  const patterns = new Map<string, TransferPattern>();
  for (const p of BUILTIN_TRANSFER_PATTERNS) patterns.set(p.pattern, p);
  // DB-derived patterns win over built-ins: they carry rule ids for the
  // flywheel, and the rulebook is where corrections/retirements happen.
  for (const p of extraPatterns) patterns.set(p.pattern, p);

  const errors: TransferError[] = [];
  for (const p of patterns.values()) {
    const re = patternRegex(p.pattern);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      errors.push({
        match: m[0],
        category: p.category,
        index: m.index,
        rule_id: p.rule_id,
        suggestion: p.suggestion,
      });
    }
  }
  errors.sort((a, b) => a.index - b.index);
  return { errors, severity: severityFor(errors.length) };
}
