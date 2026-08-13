import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface TranscriptClozeMatch {
  arabic: string;
  english: string | null;
  transcriptionId: string;
  transcriptionTitle: string;
  startMs?: number;
  endMs?: number;
}

interface Line {
  arabic?: string;
  translation?: string;
  startMs?: number;
  endMs?: number;
  tokens?: Array<{ surface?: string }>;
}

interface Row {
  id: string;
  title: string;
  lines: Line[] | null;
  dialect: string | null;
}

// Word-boundary match honoring Arabic punctuation
const containsWord = (sentence: string, word: string) => {
  if (!sentence || !word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\s|[،.,!؟?])${escaped}(?=$|\\s|[،.,!؟?])`);
  return re.test(sentence);
};

const tokenHasWord = (line: Line, word: string) =>
  Array.isArray(line.tokens) && line.tokens.some((t) => t?.surface === word);

/**
 * Auto-mint cloze candidates for a target word by scanning the user's own
 * saved transcriptions for sentences containing the word (#13).
 * Returns the shortest qualifying sentence to keep the cloze focused.
 */
export const useTranscriptCloze = (params: {
  wordArabic: string | null | undefined;
  dialect: string;
  enabled?: boolean;
}) => {
  const { user } = useAuth();
  const { wordArabic, dialect, enabled = true } = params;
  const target = (wordArabic ?? "").trim();

  return useQuery({
    queryKey: ["transcript-cloze", user?.id, dialect, target],
    queryFn: async (): Promise<TranscriptClozeMatch | null> => {
      if (!user || !target) return null;
      const { data, error } = await supabase
        .from("saved_transcriptions")
        .select("id, title, lines, dialect")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;

      const rows = (data ?? []) as Row[];
      const candidates: TranscriptClozeMatch[] = [];
      for (const r of rows) {
        // soft dialect filter — fall through if transcription has no dialect tag
        if (r.dialect && r.dialect !== dialect) continue;
        for (const line of r.lines ?? []) {
          const arabic = (line?.arabic ?? "").trim();
          if (!arabic) continue;
          // length sanity: 3–22 words, avoid monster sentences
          const wordCount = arabic.split(/\s+/).length;
          if (wordCount < 3 || wordCount > 22) continue;
          if (!containsWord(arabic, target) && !tokenHasWord(line, target)) continue;
          candidates.push({
            arabic,
            english: line.translation ?? null,
            transcriptionId: r.id,
            transcriptionTitle: r.title,
            startMs: line.startMs,
            endMs: line.endMs,
          });
        }
      }
      if (candidates.length === 0) return null;
      // Prefer shorter, more focused sentences
      candidates.sort(
        (a, b) => a.arabic.split(/\s+/).length - b.arabic.split(/\s+/).length,
      );
      return candidates[0];
    },
    enabled: enabled && !!user && !!target,
    staleTime: 5 * 60_000,
  });
};
