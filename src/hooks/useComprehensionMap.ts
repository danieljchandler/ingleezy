import { useMemo } from "react";
import { useUserVocabulary } from "@/hooks/useUserVocabulary";
import { useUserPhrases } from "@/hooks/useUserPhrases";
import {
  buildKnownTokenSet,
  MIN_KNOWN_WORDS,
  transcriptComprehension,
  type Comprehension,
} from "@/lib/comprehension";

interface VideoLike {
  id: string;
  dialect?: string | null;
  transcript_lines?: unknown;
}

/**
 * Per-video transcript comprehension for the signed-in learner, computed from
 * the decks already in the react-query cache — no extra network. Returns an
 * empty map until the learner has saved enough words for coverage to mean
 * anything (MIN_KNOWN_WORDS), so a brand-new account sees the ordinary
 * browse grid rather than a wall of red bars.
 */
export function useComprehensionMap(
  videos: VideoLike[] | undefined,
): Map<string, Comprehension> {
  const { data: words } = useUserVocabulary();
  const { data: phrases } = useUserPhrases();

  return useMemo(() => {
    const map = new Map<string, Comprehension>();
    const entries = [
      ...(words ?? []).map((w) => w.word_arabic),
      ...(phrases ?? []).map((p) => p.phrase_arabic),
    ];
    const known = buildKnownTokenSet(entries);
    if (known.size < MIN_KNOWN_WORDS) return map;

    for (const video of videos ?? []) {
      const result = transcriptComprehension(video.transcript_lines, known, video.dialect);
      if (result) map.set(video.id, result);
    }
    return map;
  }, [videos, words, phrases]);
}
