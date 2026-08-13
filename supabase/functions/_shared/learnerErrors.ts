// Persist what the learner got wrong, so it can be practised again.
//
// The scoring functions already compute detailed, high-quality error data —
// Azure returns per-phoneme error types, score-shadow-attempt returns a per-word
// alignment diff, practice-sentence-coach returns a natural rewrite and targeted
// tips — and every one of them rendered it once and dropped it. Nothing
// accumulated, so nothing could ever be remediated.
//
// This module is the write side of `learner_errors` (see the
// 20260726100000_learner_errors migration). The read side is the `weak` bucket
// in learnerProfile.ts, which is what feeds generated content.
//
// Every function here is best-effort and never throws: recording an error must
// not be able to fail the scoring request the learner is actually waiting on.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export type LearnerErrorSource =
  | "pronunciation"
  | "shadow"
  | "sentence_coach"
  | "set_phrase_voice"
  | "quiz"
  | "writing";

export interface LearnerErrorInput {
  source: LearnerErrorSource;
  dialect?: string;
  targetArabic: string;
  producedArabic?: string | null;
  errorKind?: string;
  detail?: Record<string, unknown>;
  wordId?: string | null;
  userVocabularyId?: string | null;
}

/** Cap per request so a long utterance can't write hundreds of rows. */
const MAX_ROWS_PER_CALL = 12;

/**
 * Resolve the calling user from the request's bearer token.
 *
 * usageCap has an equivalent private helper, but not every scoring function
 * calls enforceDailyCap (score-shadow-attempt doesn't), so this is exported for
 * the ones that need a user id without a cap.
 */
export async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * Write error rows for a known user. No-op when there is no user or nothing to
 * record. Safe to call without awaiting.
 */
export async function recordLearnerErrors(
  userId: string | null | undefined,
  entries: LearnerErrorInput[],
): Promise<void> {
  if (!userId || entries.length === 0) return;

  const rows = entries
    .filter((e) => e.targetArabic?.trim())
    .slice(0, MAX_ROWS_PER_CALL)
    .map((e) => ({
      user_id: userId,
      dialect: e.dialect || "Gulf",
      source: e.source,
      target_arabic: e.targetArabic.trim(),
      produced_arabic: e.producedArabic?.trim() || null,
      error_kind: e.errorKind || "other",
      detail: e.detail ?? {},
      word_id: e.wordId ?? null,
      user_vocabulary_id: e.userVocabularyId ?? null,
    }));

  if (rows.length === 0) return;

  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supa.from("learner_errors").insert(rows);
    if (error) console.warn("[learnerErrors] insert failed:", error.message);
  } catch (e) {
    console.warn("[learnerErrors] insert threw:", e);
  }
}

/** Resolve the user from the request, then record. Convenience for uncapped functions. */
export async function recordLearnerErrorsForRequest(
  req: Request,
  entries: LearnerErrorInput[],
): Promise<void> {
  if (entries.length === 0) return;
  const userId = await resolveUserId(req);
  await recordLearnerErrors(userId, entries);
}

/** Resolve the user from the request, then clear. Counterpart of the above. */
export async function resolveLearnerErrorsForRequest(
  req: Request,
  targetArabic: string | string[],
  dialect?: string,
): Promise<void> {
  const targets = Array.isArray(targetArabic) ? targetArabic : [targetArabic];
  if (targets.every((t) => !t?.trim())) return;
  const userId = await resolveUserId(req);
  await resolveLearnerErrors(userId, targetArabic, dialect);
}

/**
 * Mark a target as no longer problematic — call when the learner gets it right.
 *
 * Without this the weak set only ever grows, and content would keep drilling
 * words the learner has since fixed.
 */
export async function resolveLearnerErrors(
  userId: string | null | undefined,
  targetArabic: string | string[],
  dialect?: string,
): Promise<void> {
  if (!userId) return;

  // Accepts a list because errors are recorded per word: a clean utterance
  // clears several at once, and one `in` beats N round trips.
  const targets = [...new Set(
    (Array.isArray(targetArabic) ? targetArabic : [targetArabic])
      .map((t) => t?.trim())
      .filter((t): t is string => !!t),
  )];
  if (targets.length === 0) return;

  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let q = supa
      .from("learner_errors")
      .update({ resolved_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("target_arabic", targets)
      .is("resolved_at", null);
    if (dialect) q = q.eq("dialect", dialect);
    const { error } = await q;
    if (error) console.warn("[learnerErrors] resolve failed:", error.message);
  } catch (e) {
    console.warn("[learnerErrors] resolve threw:", e);
  }
}
