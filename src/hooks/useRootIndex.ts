import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { familyKey } from "@/lib/wordFamily";
import { useAuth } from "./useAuth";
import { useRootFamilyPrefs } from "./useRootFamilyPrefs";

export interface RootIndexEntry {
  id: string;
  word_arabic: string;
  word_english: string;
  /** The stored spelling — kept for display; never compare on it. */
  root: string;
  dialect: string;
  /** FSRS stability, in days. `ease_factor` is the column it lives in. */
  ease_factor: number;
  repetitions: number;
  word_audio_url: string | null;
  image_url: string | null;
}

/** Buckets keyed by `familyKey`, each sorted strongest-remembered first. */
export type RootIndex = Map<string, RootIndexEntry[]>;

const ROOT_INDEX_COLUMNS =
  "id, word_arabic, word_english, root, dialect, ease_factor, repetitions, word_audio_url, image_url";

/**
 * The learner's family-bearing vocabulary, bucketed by canonical family.
 *
 * One query per session rather than one per card. The lookup this replaced ran
 * inside the review loop, so a forty-card session made forty round trips to ask
 * forty variations of the same question; the answers were also unusable,
 * because matching happened in SQL on an unnormalised free-text column.
 *
 * Grouping in TypeScript instead is what lets `familyKey` reconcile the
 * spellings already sitting in the database — "Act", "act" and "act-" become
 * one family with no migration. It is also what quietly retires the Arabic
 * roots written before the flip: `familyKey` refuses Arabic script, so those
 * rows drop out of the index instead of forming families an English learner
 * cannot use.
 *
 * Deliberately **not** filtered by dialect. A word family is a fact about
 * English, not about the learner's L1, and the caller knows which card it is
 * annotating; scoping per card is what makes mixed-dialect review sessions
 * correct, where a single query-level filter could only ever be right for one
 * of the decks in play.
 */
export const useRootIndex = (options?: { enabled?: boolean }) => {
  const { user } = useAuth();
  const { enabled: rootFamiliesEnabled } = useRootFamilyPrefs();

  return useQuery({
    queryKey: ["root-index", user?.id],
    queryFn: async (): Promise<RootIndex> => {
      const index: RootIndex = new Map();
      if (!user) return index;

      const { data, error } = await supabase
        .from("user_vocabulary")
        .select(ROOT_INDEX_COLUMNS)
        .eq("user_id", user.id)
        // `null` means nobody has looked yet; `''` means we looked and there is
        // no family. Neither can join one, so neither is worth fetching.
        .not("root", "is", null)
        .neq("root", "");
      if (error) throw error;

      for (const row of (data ?? []) as RootIndexEntry[]) {
        const key = familyKey(row.root);
        if (!key) continue;
        const bucket = index.get(key);
        if (bucket) bucket.push(row);
        else index.set(key, [row]);
      }

      // Strongest first: the words a learner remembers best are the ones that
      // can actually anchor a new one to the pattern.
      for (const bucket of index.values()) {
        bucket.sort((a, b) => (b.ease_factor ?? 0) - (a.ease_factor ?? 0));
      }

      return index;
    },
    enabled: (options?.enabled ?? true) && !!user && rootFamiliesEnabled,
    staleTime: 5 * 60_000,
  });
};
