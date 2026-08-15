import { useMemo } from "react";
import { familyKey as toFamilyKey, formatFamily } from "@/lib/wordFamily";
import { useRootFamilyPrefs } from "./useRootFamilyPrefs";
import { useRootIndex, type RootIndexEntry } from "./useRootIndex";

export type SiblingWord = RootIndexEntry;

/** How many siblings fit under a card before the list stops being a footnote. */
export const SIBLING_LIMIT = 5;

export interface SiblingWords {
  /** Up to `limit` siblings, strongest-remembered first. */
  siblings: SiblingWord[];
  /** How many siblings exist in total, so "+N more" can be honest. */
  total: number;
  /** The canonical key, for opening the family sheet. Null when there is no usable root. */
  familyKey: string | null;
  /** Ready-to-render base form, e.g. "act". */
  rootDisplay: string | null;
  isLoading: boolean;
}

/**
 * Words in the learner's deck sharing a word family with the card in front of
 * them.
 *
 * This began as Arabic root morphology — كتب, كتاب, مكتب and كاتب are one root
 * apart — and the teaching move survives the flip even though the linguistics
 * do not: act, action, active and actor are one family, and seeing them
 * together during review turns four unrelated memorisations into one pattern.
 * Surfacing the wrong siblings is worse than surfacing none — a false
 * connection is harder to unlearn than no connection.
 *
 * So the selection is narrow on purpose: same learner, same dialect as the card
 * being reviewed, same canonical family, never the card itself.
 *
 * Two things changed from the query this used to be, both of which were quietly
 * returning nothing:
 *
 * - Matching goes through `familyKey` rather than SQL equality. The column
 *   holds whatever spelling the AI that saved the card happened to use, so
 *   "Act" and "act" were never siblings despite being the same family.
 * - The dialect compared is the *card's*, not the app's active dialect. In a
 *   mixed-dialect session the deck spans all three, so filtering on the active
 *   one matched Yemeni cards against Gulf siblings.
 *
 * It also no longer reads `user_vocabulary.stage`. That column is created by no
 * migration, is written only by the Anki importer, and sorts alphabetically —
 * mastery comes from FSRS stability instead, which is what the analytics were
 * already fixed to do.
 */
export const useSiblingWords = (params: {
  root: string | null | undefined;
  excludeId: string;
  /** The dialect of the card being reviewed — not the app's active dialect. */
  dialect: string;
  limit?: number;
  enabled?: boolean;
}): SiblingWords => {
  const { root, excludeId, dialect, limit = SIBLING_LIMIT, enabled = true } = params;

  const familyKey = toFamilyKey(root);
  const { enabled: rootFamiliesEnabled } = useRootFamilyPrefs();
  const { data: index, isLoading } = useRootIndex({ enabled: enabled && !!familyKey });
  const show = enabled && rootFamiliesEnabled;

  return useMemo(() => {
    // Both gates have to suppress the *result*, not merely the fetch. The index
    // is shared and cached, so switching the feature off mid-session would
    // otherwise keep serving rows already sitting in the cache until they went
    // stale — the panel would survive its own preference being turned off.
    const family = show && familyKey ? (index?.get(familyKey) ?? []) : [];
    const matches = family.filter(
      (entry) => entry.id !== excludeId && entry.dialect === dialect,
    );

    return {
      siblings: matches.slice(0, limit),
      total: matches.length,
      familyKey,
      rootDisplay: show ? formatFamily(root) : null,
      isLoading: show && !!familyKey && isLoading,
    };
  }, [index, familyKey, excludeId, dialect, limit, root, isLoading, show]);
};
