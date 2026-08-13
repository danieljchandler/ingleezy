// Fire-and-forget logger that records MSA leaks into `dialect_rule_violations`
// and (when severity warrants) into `dialect_native_reviews` for native review.
// Never throws. Uses service-role client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { Dialect } from './dialectHelpers.ts';
import type { MsaLeakResult } from './msaLeakDetector.ts';
import type { ValidatorResult } from './dialectValidator.ts';

interface LogArgs {
  dialect: Dialect;
  leaks: MsaLeakResult;
  offendingText: string;
  sourceFunction: string;
  metadata?: Record<string, unknown>;
  /** If true (or severity >= medium), also enqueue a native-review row. */
  enqueueReview?: boolean;
  /**
   * Native-speaker validator result, when one ran for this same text.
   * If the validator scored the text as authentic (verdict='pass' AND
   * score >= 4), we treat the detector hits as likely false positives:
   * severity is forced to 'low' and the native-review enqueue is skipped.
   */
  validator?: { ok: boolean; verdict: 'pass' | 'rewrite' | 'unknown'; score: number };
}

interface LogValidatorArgs {
  dialect: Dialect;
  result: ValidatorResult;
  offendingText: string;
  sourceFunction: string;
  metadata?: Record<string, unknown>;
  enqueueReview?: boolean;
}

let cached: ReturnType<typeof createClient> | null = null;
function client() {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export function logMsaViolations(args: LogArgs): void {
  try {
    if (!args.leaks?.leaks?.length) return;
    const sb = client();
    if (!sb) return;

    // Validator-gated downgrade: if the native-speaker validator already
    // judged this text authentic, the detector hits are almost always false
    // positives (over-broad rule entries, spelling variants). Downgrade and
    // skip native review.
    const validatorPassed =
      args.validator?.ok === true &&
      args.validator.verdict === 'pass' &&
      args.validator.score >= 4;
    const effectiveSeverity: MsaLeakResult['severity'] = validatorPassed
      ? 'low'
      : args.leaks.severity;

    const snippet = (args.offendingText ?? '').slice(0, 2000);
    const ruleHits = args.leaks.ruleHits ?? {};
    const rows = args.leaks.leaks.slice(0, 20).map((token) => ({
      dialect: args.dialect,
      offending_text: snippet,
      msa_token: token,
      rule_id: ruleHits[token] ?? null,
      detected_by: 'msa_leak_detector',
      source_function: args.sourceFunction,
      metadata: {
        severity: effectiveSeverity,
        original_severity: args.leaks.severity,
        validator_passed: validatorPassed,
        validator_score: args.validator?.score ?? null,
        ...(args.metadata ?? {}),
      },
    }));

    sb.from('dialect_rule_violations').insert(rows as any).then(
      ({ data, error }) => {
        if (error) console.warn('[msaViolationLogger] insert failed:', error.message);
        // Enqueue native review when medium/high severity (or explicit flag),
        // but never when the validator already cleared the text.
        const shouldReview =
          !validatorPassed && (
            args.enqueueReview === true ||
            effectiveSeverity === 'medium' ||
            effectiveSeverity === 'high'
          );
        if (!shouldReview) return;
        const violationId = (data as any)?.[0]?.id ?? null;
        sb.from('dialect_native_reviews').insert([{
          dialect: args.dialect,
          content_type: args.sourceFunction || 'manual',
          original_text: snippet,
          status: 'pending',
          source: 'msa_leak_detector',
          violation_id: violationId,
          source_function: args.sourceFunction,
          metadata: {
            severity: effectiveSeverity,
            leaks: args.leaks.leaks,
            ...(args.metadata ?? {}),
          },
        }] as any).then(
          ({ error: e2 }) => {
            if (e2) console.warn('[msaViolationLogger] review insert failed:', e2.message);
          },
          (err) => console.warn('[msaViolationLogger] review insert threw:', err),
        );
      },
      (err) => console.warn('[msaViolationLogger] insert threw:', err),
    );
  } catch (err) {
    console.warn('[msaViolationLogger] unexpected error:', err);
  }
}

export function logValidatorResult(args: LogValidatorArgs): void {
  try {
    if (!args.result?.ok) return;
    if (args.result.verdict === 'pass' && (args.result.leaks?.length ?? 0) === 0) return;
    const sb = client();
    if (!sb) return;
    const snippet = (args.offendingText ?? '').slice(0, 2000);

    // Always log each detected leak as a violation row.
    const leaks = args.result.leaks ?? [];
    const rows = leaks.slice(0, 20).map((l) => ({
      dialect: args.dialect,
      offending_text: snippet,
      msa_token: l.token,
      suggested_replacement: l.suggestion ?? null,
      detected_by: 'native_validator',
      source_function: args.sourceFunction,
      metadata: {
        score: args.result.score,
        verdict: args.result.verdict,
        reason: l.reason ?? null,
        ...(args.metadata ?? {}),
      },
    }));
    const insertViolations = rows.length
      ? sb.from('dialect_rule_violations').insert(rows as any)
      : Promise.resolve({ data: null, error: null } as any);

    insertViolations.then(
      ({ error }: any) => {
        if (error) console.warn('[validatorLogger] insert failed:', error.message);
      },
      (err: unknown) => console.warn('[validatorLogger] insert threw:', err),
    );

    // Enqueue a native review when verdict is rewrite (low score) or explicitly requested.
    const shouldReview = args.enqueueReview === true || args.result.verdict === 'rewrite';
    if (!shouldReview) return;

    sb.from('dialect_native_reviews').insert([{
      dialect: args.dialect,
      content_type: args.sourceFunction || 'manual',
      original_text: snippet,
      status: 'pending',
      source: 'native_validator',
      source_function: args.sourceFunction,
      metadata: {
        score: args.result.score,
        verdict: args.result.verdict,
        leaks: args.result.leaks,
        notes: args.result.notes,
        ...(args.metadata ?? {}),
      },
    }] as any).then(
      ({ error: e2 }: any) => {
        if (e2) console.warn('[validatorLogger] review insert failed:', e2.message);
      },
      (err: unknown) => console.warn('[validatorLogger] review insert threw:', err),
    );
  } catch (err) {
    console.warn('[validatorLogger] unexpected error:', err);
  }
}
