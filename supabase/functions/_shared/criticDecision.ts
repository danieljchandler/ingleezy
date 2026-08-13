// Which of the two payloads draft_critic ends up with — the draft, or the
// critic's rewrite of it.
//
// This lives in its own dependency-free module for the same reason
// passageQualityCore.ts does: it decides what the learner actually reads, and
// it needs to be unit-testable from the frontend Vitest suite rather than only
// observable by making two live model calls and eyeballing the Arabic.
//
// It earned that treatment. The rule it replaces compared MSA-leak *token
// counts* between draft and rewrite and kept the draft whenever the rewrite
// scored higher — including when the rewrite existed only because a native
// speaker had judged the draft to be fusha. That test is biased against exactly
// the case it was adjudicating: fusha register (case endings, MSA verb
// morphology, classical lexis) trips no token blacklist, so a fusha draft
// typically scores ZERO leaks, while an authentic dialect rewrite only has to
// contain one flagged word — ذلك, أيضاً, سوف, or any token harvested from the
// rulebook — to "regress" and be thrown away. The worse the draft was, the more
// reliably its replacement got rejected.

export interface CriticDecisionInput {
  /** Quality-gate reason for the draft, or null when the draft was complete. */
  draftGateReason: string | null;
  /** Quality-gate reason for the critic's rewrite, or null when it was complete. */
  criticGateReason: string | null;
  /** MSA-leak tokens found in the draft. */
  draftLeakCount: number;
  /** MSA-leak tokens found in the rewrite. */
  criticLeakCount: number;
  /**
   * True when the native-speaker validator judged the DRAFT inauthentic and
   * asked for the rewrite. This is the signal the old rule ignored.
   */
  dialectDrift: boolean;
}

export interface CriticDecision {
  keep: 'draft' | 'critic';
  /** Short, log-ready explanation. */
  reason: string;
}

/**
 * Decide whether to ship the critic's rewrite or fall back to the draft.
 *
 * The one thing a rewrite can always lose on is completeness: if it dropped a
 * field the draft had, the UI renders a hole, and no amount of dialect
 * authenticity compensates. Everything else is a judgment about register, and
 * on register the native-speaker validator outranks the token blacklist.
 *
 * Leaked tokens in an accepted rewrite are not ignored — they fall through to
 * askBrain's repair pass, which is handed the offending tokens by name and is
 * strictly better at removing them than this comparison is at avoiding them.
 */
export function decideCriticOutcome(input: CriticDecisionInput): CriticDecision {
  const {
    draftGateReason,
    criticGateReason,
    draftLeakCount,
    criticLeakCount,
    dialectDrift,
  } = input;

  // The rewrite dropped something the draft had. Unusable regardless of register.
  if (draftGateReason === null && criticGateReason !== null) {
    return { keep: 'draft', reason: `critic broke completeness: ${criticGateReason}` };
  }

  // The rewrite exists because a native speaker read the draft and called it
  // fusha. Keeping the draft here means knowingly shipping text we have already
  // judged unfit, so the rewrite wins on any leak count. This is the case the
  // old count comparison silently reversed.
  if (dialectDrift) {
    return {
      keep: 'critic',
      reason:
        criticLeakCount > draftLeakCount
          ? `dialect rewrite accepted despite ${criticLeakCount} leak token(s) (draft had ${draftLeakCount}); repair pass will take them`
          : 'dialect rewrite accepted',
    };
  }

  // The rewrite fixed what the draft was missing. Take it.
  if (draftGateReason !== null && criticGateReason === null) {
    return { keep: 'critic', reason: `critic fixed completeness: ${draftGateReason}` };
  }

  // No verdict against the draft and no completeness change: the only thing
  // left to compare is leak tokens, and a rewrite that drifted further into MSA
  // without fixing anything is not worth taking.
  if (criticLeakCount > draftLeakCount) {
    return {
      keep: 'draft',
      reason: `critic leaked more MSA (${criticLeakCount} vs ${draftLeakCount}) and fixed nothing`,
    };
  }

  return { keep: 'critic', reason: 'critic output accepted' };
}
