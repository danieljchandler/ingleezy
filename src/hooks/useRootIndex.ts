import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { rootKey } from "@/lib/arabicRoot";
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

/** Buckets keyed by `rootKey`, each sorted strongest-remembered first. */
export type RootIndex = Map<string, RootIndexEntry[]>;

const ROOT_INDEX_COLUMNS =
  "id, word_arabic, word_english, root, dialect, ease_factor, repetitions, word_audio_url, image_url";

/**
 * The learner's root-bearing vocabulary, bucketed by canonical root.
 *
 * One query per session rather than one per card. The lookup this replaced ran
 * inside the review loop, so a forty-card session made forty round trips to ask
 * forty variations of the same question; the answers were also unusable,
 * because matching happened in SQL on an unnormalised free-text column.
 *
 * Grouping in TypeScript instead is what lets `rootKey` reconcile the spellings
 * already sitting in the database — "ك-ت-ب", "ك ت ب" and "كتب" become one
 * family with no migration and no backfill of existing rows.
 *
 * Deliberately **not** filtered by dialect. Roots are shared across dialects,
 * and the caller knows which card it is annotating; scoping per card is what
 * makes mixed-dialect review sessions correct, where a single query-level
 * filter could only ever be right for one of the decks in play.
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
        // no root. Neither can join a family, so neither is worth fetching.
        .not("root", "is", null)
        .neq("root", "");
      if (error) throw error;

      for (const row of (data ?? []) as RootIndexEntry[]) {
        const key = rootKey(row.root);
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
