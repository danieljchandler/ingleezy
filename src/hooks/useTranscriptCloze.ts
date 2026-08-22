import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { DIALECT_MODULE_VALUES, type Dialect } from "@/config";

/**
 * Finds a real sentence to blank a word out of, from content the learner has
 * actually met.
 *
 * A saved word usually carries its own example sentence, and when it does that
 * one wins — it is the sentence the word was learned in. This is the fallback
 * for the ones that do not, and the alternative to it is no cloze card at all.
 *
 * The flip changed what it mines. It used to scan the learner's saved
 * transcriptions for an ARABIC sentence containing the Arabic word, which was
 * right when Arabic was the target and is exactly wrong now: the cloze blanks
 * an English word out of an English sentence, so an Arabic sentence is not a
 * harder version of the card, it is a different card. It was parked rather than
 * flipped because at the time nothing in the database held English transcript
 * lines. `process-english-video` changed that, so this reads them now.
 *
 * Two sources, deliberately in this order:
 *   1. `saved_transcriptions` — audio the learner uploaded themselves. Best
 *      material there is: they have already heard this sentence.
 *   2. `discover_videos` — published native English clips. Not personal, but
 *      it is the library every learner shares, and without it a learner who
 *      has never used the transcriber gets nothing from this hook at all.
 *
 * Bridged Hakiya rows need no filter of their own: their lines are Arabic
 * speech and carry no `english`, so they fall out on the same test that decides
 * every other line. Reading `source` to exclude them up front would have been
 * the obvious way and is the worse one — the column is absent from the
 * generated types (see `typesDrift.ts`), so it costs a cast to buy nothing.
 */
export interface TranscriptClozeMatch {
  /** The English sentence the blank will be cut from. */
  english: string;
  /** Its dialect translation, revealed after the learner answers. */
  arabic: string | null;
  sourceId: string;
  sourceTitle: string;
  /** Whether it came from the learner's own upload or the shared library. */
  origin: "upload" | "library";
  startMs?: number;
  endMs?: number;
}

interface Line {
  english?: string;
  arabic?: string;
  translation?: string;
  startMs?: number;
  endMs?: number;
}

/**
 * Word-boundary match on English.
 *
 * `\b` rather than the Arabic punctuation class the Arabic version needed, and
 * case-insensitive because a sentence-initial "Market" is the same word as the
 * card's "market" — the same reason `ReviewClozeCard` builds its blank
 * case-insensitively. Without that the two disagree, and the hook hands over a
 * sentence the card then cannot find the word in, which renders a cloze with
 * nothing blanked.
 */
const containsWord = (sentence: string, word: string) => {
  if (!sentence || !word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(sentence);
};

/** Long enough to give context, short enough to read on a card. */
const WORD_COUNT_MIN = 3;
const WORD_COUNT_MAX = 22;

const eligible = (english: string, target: string) => {
  const words = english.split(/\s+/).length;
  if (words < WORD_COUNT_MIN || words > WORD_COUNT_MAX) return false;
  return containsWord(english, target);
};

export const useTranscriptCloze = (params: {
  /** The English word the card is testing. */
  wordEnglish: string | null | undefined;
  dialect: string;
  enabled?: boolean;
}) => {
  const { user } = useAuth();
  const { wordEnglish, dialect, enabled = true } = params;
  const target = (wordEnglish ?? "").trim();

  return useQuery({
    queryKey: ["transcript-cloze", user?.id, dialect, target],
    queryFn: async (): Promise<TranscriptClozeMatch | null> => {
      if (!user || !target) return null;

      const moduleValues = DIALECT_MODULE_VALUES[dialect as Dialect] ?? [dialect];

      const [ownRes, libraryRes] = await Promise.all([
        supabase
          .from("saved_transcriptions")
          .select("id, title, lines")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(40),
        supabase
          .from("discover_videos")
          .select("id, title, transcript_lines, dialect")
          .eq("published", true)
          .order("created_at", { ascending: false })
          .limit(25),
      ]);

      // A failure on either side is a missing fallback, not a broken review:
      // the card this feeds is already optional, and throwing here would take
      // down a session over a sentence the learner never asked for.
      const candidates: TranscriptClozeMatch[] = [];

      const collect = (
        rows: Array<{ id: string; title: string; lines: unknown }>,
        origin: "upload" | "library",
      ) => {
        for (const row of rows) {
          for (const line of (row.lines as Line[] | null) ?? []) {
            const english = (line?.english ?? "").trim();
            if (!english || !eligible(english, target)) continue;
            candidates.push({
              english,
              arabic: line.arabic?.trim() || line.translation?.trim() || null,
              sourceId: row.id,
              sourceTitle: row.title,
              origin,
              startMs: line.startMs,
              endMs: line.endMs,
            });
          }
        }
      };

      collect(
        (ownRes.data ?? []).map((r) => ({ id: r.id, title: r.title, lines: r.lines })),
        "upload",
      );

      collect(
        (libraryRes.data ?? [])
          // A Gulf learner's scaffold is Gulf, so prefer clips tagged for their
          // module — the English is the same either way, but the translation
          // revealed underneath it is not.
          .filter((r) => !r.dialect || moduleValues.includes(r.dialect))
          .map((r) => ({ id: r.id, title: r.title, lines: r.transcript_lines })),
        "library",
      );

      if (candidates.length === 0) return null;

      // The learner's own audio first, then the shortest sentence: a cloze is
      // easier to read when there is less around the blank.
      candidates.sort((a, b) => {
        if (a.origin !== b.origin) return a.origin === "upload" ? -1 : 1;
        return a.english.split(/\s+/).length - b.english.split(/\s+/).length;
      });
      return candidates[0];
    },
    enabled: enabled && !!user && !!target,
    staleTime: 5 * 60_000,
  });
};
