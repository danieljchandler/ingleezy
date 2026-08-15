import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { calculateNextReview, elapsedDaysSince, Rating, type ScheduleOptions } from '@/lib/spacedRepetition';
import { useDesiredRetention } from './useDesiredRetention';
import {
  buildReviewOrder,
  scheduleDirectionFor,
  type CardDirection,
  type ScheduleDirection,
} from '@/lib/reviewOrder';
import { useAddXP, useIncrementReviews, useCheckAchievements } from './useGamification';
import { useDialect } from '@/contexts/DialectContext';
import { useNewCardCap } from './useNewCardCap';
import { useRemainingNewCardBudget } from './useNewCardBudget';

export interface WordReview {
  id: string;
  user_id: string;
  word_id: string;
  ease_factor: number;  // stores FSRS stability
  // FSRS difficulty (1–10). Optional here because the generated Supabase types
  // predate the difficulty column; the column exists at runtime (select('*')
  // returns it) and callers fall back to 5.0 when it's absent.
  difficulty?: number;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  next_review_at: string;
  // Recognition-side lapse/leech tracking, added alongside the production
  // schedule. Optional for the same reason as `difficulty` — the generated
  // types lag the migration.
  lapses?: number | null;
  is_leech?: boolean | null;
  /** Learner's own memory hook for a stuck card; written by LeechHelperPanel. */
  mnemonic?: string | null;
  // Production schedule (meaning → Arabic). production_next_review_at is null
  // until the learner recognises the word reliably; see buildReviewUpdate.
  production_lapses?: number | null;
  production_ease_factor?: number | null;
  production_difficulty?: number | null;
  production_interval_days?: number | null;
  production_repetitions?: number | null;
  production_last_reviewed_at?: string | null;
  production_next_review_at?: string | null;
}

export interface VocabularyWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  // Nullable in the schema: words attached to a lesson have no topic.
  topic_id: string | null;
  image_position?: string | null;
  dialect_module?: string;
  /** English word-family base form. Null until backfilled; '' means the word has none. */
  word_family?: string | null;
}

interface WordWithReview extends VocabularyWord {
  review: WordReview | null;
  topic: {
    name: string;
    name_arabic: string;
    gradient: string;
    icon: string;
  };
}

/**
 * A curriculum word presented in one direction.
 *
 * The deck used to serve one flip card per word — Arabic → English, tap, rate.
 * A word can now appear as up to three cards in a session (recognition, audio,
 * production), each with its own schedule fields hoisted to the top level so
 * the ordering in src/lib/reviewOrder.ts and the rating path don't have to know
 * which column set they came from.
 */
export interface DueCurriculumCard extends WordWithReview {
  card_type: CardDirection;
  due_at: string;
  repetitions: number;
}

export const useDueWords = (mixAll = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const { cap: newCap } = useNewCardCap();
  const { remaining: remainingNewBudget } = useRemainingNewCardBudget(newCap);

  return useQuery({
    queryKey: ['due-words', user?.id, mixAll ? 'all' : activeDialect, remainingNewBudget],
    queryFn: async (): Promise<DueCurriculumCard[]> => {
      if (!user) return [];

      const now = new Date().toISOString();

      let query = supabase
        .from('vocabulary_words')
        .select(`
          id,
          word_arabic,
          word_english,
          image_url,
          audio_url,
          topic_id,
          lesson_id,
          image_position,
          word_family,
          dialect_module,
          lessons (
            title,
            title_arabic,
            gradient,
            icon
          ),
          topics (
            name,
            name_arabic,
            gradient,
            icon
          )
        `);

      if (!mixAll) {
        query = query.eq('dialect_module', activeDialect);
      }

      const { data: words, error: wordsError } = await query;
      if (wordsError) throw wordsError;

      const { data: reviews, error: reviewsError } = await supabase
        .from('word_reviews')
        .select('*')
        .eq('user_id', user.id);

      if (reviewsError) throw reviewsError;

      const reviewMap = new Map((reviews ?? []).map(r => [r.word_id, r as unknown as WordReview]));

      const withReview: WordWithReview[] = (words ?? []).map(word => {
        const review = reviewMap.get(word.id) || null;
        const lessonData = (word as any).lessons;
        const topicData = (word as any).topics;
        const resolvedTopic = lessonData
          ? { name: lessonData.title, name_arabic: lessonData.title_arabic || '', gradient: lessonData.gradient, icon: lessonData.icon }
          : topicData;
        return {
          ...word,
          review,
          topic: resolvedTopic as WordWithReview['topic'],
        };
      });

      const nowMs = new Date(now).getTime();
      const cards: DueCurriculumCard[] = [];

      for (const word of withReview) {
        const review = word.review;

        // Recognition. A word with no review row has never been seen, so it is
        // due as a new card.
        const recognitionDue = !review || new Date(review.next_review_at).getTime() <= nowMs;
        if (recognitionDue) {
          const repetitions = review?.repetitions ?? 0;
          cards.push({
            ...word,
            // Alternate the input channel for recognition cards: hearing the
            // word and recalling its meaning is the direction that matters most
            // for a spoken dialect, and it was absent from every deck. Only
            // words that have some audio to play can be served this way.
            card_type: repetitions > 0 && hasAudio(word) && repetitions % 2 === 1
              ? 'audio'
              : 'recognition',
            due_at: review?.next_review_at ?? now,
            repetitions,
          });
        }

        // Production, once unlocked by a confident recognition rating.
        const productionDue =
          !!review?.production_next_review_at &&
          new Date(review.production_next_review_at).getTime() <= nowMs;
        if (productionDue && review) {
          cards.push({
            ...word,
            card_type: 'production',
            due_at: review.production_next_review_at!,
            repetitions: review.production_repetitions ?? 0,
          });
        }
      }

      // Due-date priority, new-card cap and direction interleaving, shared with
      // the personal deck. The new-card budget is server-persisted via
      // daily_new_card_counts, so it's a real daily limit rather than a
      // per-page-load one.
      return buildReviewOrder(cards, { newCardCap: remainingNewBudget });
    },
    enabled: !!user,
  });
};

/** Whether a word has audio to play — recorded, or synthesisable from its text. */
function hasAudio(word: VocabularyWord): boolean {
  return !!word.audio_url || !!word.word_arabic;
}

export const useReviewStats = (mixAll = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ['review-stats', user?.id, mixAll ? 'all' : activeDialect],
    queryFn: async () => {
      if (!user) return null;

      const now = new Date().toISOString();

      let wordsQuery = supabase
        .from('vocabulary_words')
        .select('id', { count: 'exact' });

      if (!mixAll) {
        wordsQuery = wordsQuery.eq('dialect_module', activeDialect);
      }

      const { data: wordIds, count: totalWords } = await wordsQuery;

      const { data: reviews } = await supabase
        .from('word_reviews')
        .select('*')
        .eq('user_id', user.id);

      // If filtering by dialect, only count reviews for words in this dialect
      const wordIdSet = !mixAll && wordIds ? new Set(wordIds.map((w: any) => w.id)) : null;
      const filteredReviews = wordIdSet
        ? reviews?.filter(r => wordIdSet.has(r.word_id))
        : reviews;

      // Count both directions: a word can be due for production while its
      // recognition schedule is still weeks out, and the daily queue's badge
      // would otherwise say "0 due" for a session that has cards in it.
      const nowMs = new Date(now).getTime();
      const rows = (filteredReviews ?? []) as unknown as WordReview[];
      const dueCount = rows.reduce((sum, r) => {
        let due = new Date(r.next_review_at).getTime() <= nowMs ? 1 : 0;
        if (r.production_next_review_at && new Date(r.production_next_review_at).getTime() <= nowMs) {
          due += 1;
        }
        return sum + due;
      }, 0);
      const learnedCount = rows.filter(r => r.repetitions >= 1).length;
      const masteredCount = rows.filter(r => r.repetitions >= 5).length;

      return {
        totalWords: totalWords || 0,
        dueCount,
        learnedCount,
        masteredCount,
        newCount: (totalWords || 0) - (filteredReviews?.length || 0),
      };
    },
    enabled: !!user,
  });
};

/** Lapses before a card is flagged a leech. Matches the personal deck. */
const LEECH_THRESHOLD = 6;

function leechTrackingEnabled(): boolean {
  try {
    const raw = localStorage.getItem('ingleezy:leech-tracking-enabled');
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

/**
 * Build the column update for one rating, for one direction.
 *
 * Split out and exported so the mapping from (rating, direction) to columns can
 * be tested directly: writing a production rating into the recognition columns
 * silently corrupts a card's schedule and is invisible until the learner notices
 * a word coming back far too often.
 */
export function buildReviewUpdate(
  rating: Rating,
  direction: ScheduleDirection,
  currentReview: WordReview | null,
  now: Date = new Date(),
  options?: ScheduleOptions,
): { update: Record<string, unknown>; result: ReturnType<typeof calculateNextReview> } {
  const production = direction === 'production';

  const stability = (production ? currentReview?.production_ease_factor : currentReview?.ease_factor) ?? 0;
  const difficulty = (production ? currentReview?.production_difficulty : currentReview?.difficulty) ?? 5.0;
  const intervalDays = (production ? currentReview?.production_interval_days : currentReview?.interval_days) ?? 0;
  const repetitions = (production ? currentReview?.production_repetitions : currentReview?.repetitions) ?? 0;
  const elapsedDays = elapsedDaysSince(
    production ? currentReview?.production_last_reviewed_at : currentReview?.last_reviewed_at,
  );

  const result = calculateNextReview(rating, stability, difficulty, intervalDays, repetitions, elapsedDays, options);

  const failed = rating === 'again';
  const lapses = (currentReview?.lapses ?? 0) + (failed && !production ? 1 : 0);
  const productionLapses = (currentReview?.production_lapses ?? 0) + (failed && production ? 1 : 0);
  const isLeech = leechTrackingEnabled()
    ? Math.max(lapses, productionLapses) >= LEECH_THRESHOLD
    : false;

  const nowIso = now.toISOString();
  const update: Record<string, unknown> = production
    ? {
        production_ease_factor: result.stability,
        production_difficulty: result.difficulty,
        production_interval_days: Math.max(0, Math.round(result.intervalDays)),
        production_repetitions: result.repetitions,
        production_next_review_at: result.nextReviewAt.toISOString(),
        production_last_reviewed_at: nowIso,
        production_lapses: productionLapses,
        is_leech: isLeech,
      }
    : {
        ease_factor: result.stability,
        difficulty: result.difficulty,
        interval_days: Math.max(0, Math.round(result.intervalDays)),
        repetitions: result.repetitions,
        next_review_at: result.nextReviewAt.toISOString(),
        last_reviewed_at: nowIso,
        lapses,
        is_leech: isLeech,
      };

  // Unlock the production direction once the learner can recognise the word.
  // Mirrors the personal deck (useUserVocabulary): production is a harder skill,
  // so asking for it before recognition is stable just manufactures failures.
  if (
    !production &&
    (rating === 'good' || rating === 'easy') &&
    !currentReview?.production_next_review_at
  ) {
    update.production_next_review_at = nowIso;
  }

  return { update, result };
}

export async function submitRatingToServer(
  userId: string,
  wordId: string,
  rating: Rating,
  currentReview: WordReview | null,
  direction: ScheduleDirection = 'recognition',
  options?: ScheduleOptions,
) {
  // A production rating with no existing row would build a production-only
  // column set and insert it without next_review_at, which is NOT NULL — a
  // constraint violation surfacing as an opaque failure. Production is only ever
  // unlocked from an existing recognition row, so this is unreachable; fail
  // loudly rather than relying on a comment.
  if (!currentReview && direction === 'production') {
    throw new Error(
      `Cannot create a production review for word ${wordId} with no recognition row`,
    );
  }

  // The card id seeds the load-balancing fuzz so a deck saved in one sitting
  // doesn't come due as one 200-card day; the retention target flows from the
  // learner's Settings dial via the calling hook.
  const { update, result } = buildReviewUpdate(rating, direction, currentReview, new Date(), {
    fuzzSeed: wordId,
    ...options,
  });

  if (currentReview) {
    const { error } = await supabase
      .from('word_reviews')
      .update(update as never)
      .eq('id', currentReview.id);
    if (error) throw error;
  } else {
    // A word with no row can only be rated in recognition — production is
    // unlocked from an existing recognition row, never created cold.
    const { error } = await supabase
      .from('word_reviews')
      .insert({ user_id: userId, word_id: wordId, ...update } as never);
    if (error) throw error;

    // First-ever rating of this word: claim daily new-card budget (shared
    // with the personal-vocab review path). Best-effort — never blocks the
    // review submission.
    (supabase.rpc as any)('increment_new_card_count', { _amount: 1 }).catch(() => {});
  }

  return { result, rating };
}

export const useSubmitReview = () => {
  const { user } = useAuth();
  const desiredRetention = useDesiredRetention();
  const queryClient = useQueryClient();
  const addXP = useAddXP();
  const incrementReviews = useIncrementReviews();
  const checkAchievements = useCheckAchievements();

  return useMutation({
    mutationFn: async ({
      wordId,
      rating,
      currentReview,
    }: {
      wordId: string;
      rating: Rating;
      currentReview: WordReview | null;
    }) => {
      if (!user) throw new Error('Must be logged in');
      return submitRatingToServer(user.id, wordId, rating, currentReview, 'recognition', {
        desiredRetention,
      });
    },
    onSuccess: ({ rating }) => {
      queryClient.invalidateQueries({ queryKey: ['review-stats'] });

      const xpAmounts: Record<Rating, number> = {
        'again': 5,
        'hard': 10,
        'good': 15,
        'easy': 20,
      };

      addXP.mutate({ amount: xpAmounts[rating], reason: 'review' });
      incrementReviews.mutate();
      checkAchievements.mutate();
    },
  });
};


export const useAllVocabularyWords = (mixAll = false) => {
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ['all-vocabulary-words', mixAll ? 'all' : activeDialect],
    queryFn: async (): Promise<VocabularyWord[]> => {
      let query = supabase
        .from('vocabulary_words')
        .select('id, word_arabic, word_english, image_url, audio_url, topic_id, image_position, dialect_module');

      if (!mixAll) {
        query = query.eq('dialect_module', activeDialect);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
};
