import { useReviewStats } from "@/hooks/useReview";
import { useUserVocabularyDueCount } from "@/hooks/useUserVocabulary";
import { useUserPhrasesDueCount } from "@/hooks/useUserPhrases";

export type ReviewDeckId = "curriculum" | "my-words" | "my-phrases";

export interface ReviewDeckInfo {
  id: ReviewDeckId;
  label: string;
  route: string;
  due: number;
}

/**
 * The order the daily session walks the decks in: curriculum first (it's the
 * structured material), then mined vocabulary, then saved phrases.
 */
const DECK_ORDER: ReviewDeckId[] = ["curriculum", "my-words", "my-phrases"];

export interface ReviewSession {
  decks: ReviewDeckInfo[];
  /** Cards due across every deck. */
  totalDue: number;
  isLoading: boolean;
  /**
   * The deck the session should continue into after finishing `id` — the first
   * deck in DECK_ORDER (other than `id`) that still has cards due, or null when
   * nothing is left anywhere.
   */
  nextDeck: (id: ReviewDeckId) => ReviewDeckInfo | null;
  /** Cards still due outside the given deck. */
  dueElsewhere: (id: ReviewDeckId) => number;
}

/**
 * Shared state for the daily review session, which spans three separate SRS
 * decks (curriculum `word_reviews`, mined `user_vocabulary`, saved
 * `user_phrases`).
 *
 * Each review page used to hand-roll its own "continue with N cards" chaining,
 * in three different orders and with three different copies of the same
 * conditional. This centralises the deck inventory and the ordering so the
 * session behaves the same whichever deck you enter from.
 *
 * All three counts honour the active dialect the same way the review pages
 * themselves do (pass `mixAll` to match a page in mix-all mode), so a handoff
 * can't offer cards that the destination page would then filter out.
 *
 * Caveat: the curriculum count comes from `useReviewStats`, which counts cards
 * with a schedule that has come due. Never-reviewed curriculum words are also
 * served by `/review` (via `useDueWords`) but aren't counted here, so
 * `totalDue` can understate what that page will actually show. Curriculum is
 * first in DECK_ORDER, so this never causes the session to skip past it.
 */
export function useReviewSession(mixAll = false): ReviewSession {
  const { data: curriculumStats, isLoading: curriculumLoading } = useReviewStats(mixAll);
  const { data: myWords, isLoading: myWordsLoading } = useUserVocabularyDueCount(mixAll);
  const { data: phrases, isLoading: phrasesLoading } = useUserPhrasesDueCount(mixAll);

  const byId: Record<ReviewDeckId, ReviewDeckInfo> = {
    curriculum: {
      id: "curriculum",
      label: "المنهج",
      route: "/review",
      due: curriculumStats?.dueCount ?? 0,
    },
    "my-words": {
      id: "my-words",
      label: "كلماتي",
      route: "/review/my-words",
      due: myWords?.dueCount ?? 0,
    },
    "my-phrases": {
      id: "my-phrases",
      label: "عباراتي",
      route: "/review/my-phrases",
      due: phrases?.dueCount ?? 0,
    },
  };

  const decks = DECK_ORDER.map((id) => byId[id]);
  const totalDue = decks.reduce((sum, deck) => sum + deck.due, 0);

  const nextDeck = (id: ReviewDeckId): ReviewDeckInfo | null =>
    decks.find((deck) => deck.id !== id && deck.due > 0) ?? null;

  const dueElsewhere = (id: ReviewDeckId): number =>
    decks.reduce((sum, deck) => (deck.id === id ? sum : sum + deck.due), 0);

  return {
    decks,
    totalDue,
    isLoading: curriculumLoading || myWordsLoading || phrasesLoading,
    nextDeck,
    dueElsewhere,
  };
}
