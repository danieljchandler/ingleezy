import type { Page } from "@playwright/test";
import {
  aLesson,
  aProfile,
  aSetPhrase,
  aStage,
  aTopic,
  aUserPhrase,
  aUserSetPhrase,
  aUserVocabulary,
  aUserXp,
  aVocabularyWord,
  aWordReview,
  many,
  phraseId,
  reviewId,
  setPhraseId,
  userSetPhraseId,
  vocabId,
  wordId,
} from "../../src/test/support/factories";
import type { Row } from "../../src/test/support/postgrest/types";
import type { SupabaseBackend } from "../../src/test/support/server/handler";
import { TEST_USER_ID } from "../../src/test/support/server/session";
import { installSupabaseRoutes, seedSession } from "../../src/test/support/transports/playwright";

/**
 * Supabase test double — the original entry point, now a thin layer over the
 * in-memory backend in src/test/support/.
 *
 * The API is unchanged so the specs written against it keep working; what
 * changed underneath is that the backend now honours the query. Filters,
 * ordering, limits and counts are applied, writes actually persist and are
 * recorded, and RPCs and edge functions have real implementations instead of
 * returning `null` and `{}`.
 *
 * That last point is why this rewrite was worth doing: `useAdminAuth` resolves
 * every role check through `rpc("has_role")`, so with the previous double no
 * admin route could be tested at all, and `useSubscription` reads the
 * `check-subscription` function, so no premium gate could be either.
 *
 * New specs should prefer the fixtures in e2e/support/fixtures.ts, which expose
 * the backend directly.
 */

export { TEST_USER_ID, wordId };

export interface StubOptions {
  /** Curriculum cards (vocabulary_words + a due word_reviews row each). */
  curriculumDue?: number;
  /** Saved-vocabulary recognition cards due. */
  myWordsDue?: number;
  /** Saved-phrase cards due. */
  phrasesDue?: number;
  /** Set-phrase cards due (drives the separate Today task). */
  setPhrasesDue?: number;
  /** Extra/override table fixtures, keyed by table name. */
  tables?: Record<string, Row[]>;
}

/** Seed an authenticated session so the app boots past ProtectedRoute. */
export async function signIn(page: Page): Promise<void> {
  await seedSession(page, TEST_USER_ID);
}

function buildTables(options: StubOptions): Record<string, Row[]> {
  const {
    curriculumDue = 0,
    myWordsDue = 0,
    phrasesDue = 0,
    setPhrasesDue = 0,
  } = options;

  const curriculumWords = many(aVocabularyWord, curriculumDue, (index) => ({
    id: wordId(index),
    word_arabic: `كلمة${index + 1}`,
    word_english: `word ${index + 1}`,
    topic_id: aTopic().id as string,
  }));

  // Every curriculum word gets a review row that came due yesterday, so the
  // queue doesn't depend on the daily new-card budget.
  const curriculumReviews = many(aWordReview, curriculumDue, (index) => ({
    id: reviewId(index),
    word_id: wordId(index),
  }));

  const savedWords = many(aUserVocabulary, myWordsDue, (index) => ({
    id: vocabId(index),
    word_arabic: `محفوظ${index + 1}`,
    word_english: `saved word ${index + 1}`,
  }));

  const savedPhrases = many(aUserPhrase, phrasesDue, (index) => ({
    id: phraseId(index),
    phrase_arabic: `عبارة${index + 1}`,
    phrase_english: `saved phrase ${index + 1}`,
  }));

  const setPhrases = many(aSetPhrase, setPhrasesDue, (index) => ({
    id: setPhraseId(index),
    phrase_arabic: `ثابتة${index + 1}`,
    phrase_english: `set phrase ${index + 1}`,
  }));

  const userSetPhrases = many(aUserSetPhrase, setPhrasesDue, (index) => ({
    id: userSetPhraseId(index),
    phrase_id: setPhraseId(index),
  }));

  return {
    profiles: [aProfile()],
    topics: [aTopic()],
    curriculum_stages: [],
    lessons: [],
    vocabulary_words: curriculumWords,
    word_reviews: curriculumReviews,
    user_vocabulary: savedWords,
    user_phrases: savedPhrases,
    set_phrases: setPhrases,
    user_set_phrases: userSetPhrases,
    user_xp: [aUserXp()],
    ...(options.tables ?? {}),
  };
}

/**
 * Answer every Supabase request from fixtures. Call before navigating.
 *
 * Returns the backend so a spec can assert on what the app wrote or which edge
 * functions it called — neither of which the previous version could express.
 */
export async function stubSupabase(
  page: Page,
  options: StubOptions = {},
): Promise<SupabaseBackend> {
  // Foreign hosts are not blocked here: these specs predate that guard and some
  // load third-party embeds. New specs get it via e2e/support/fixtures.ts.
  const { backend } = await installSupabaseRoutes(page, { blockForeignHosts: false });

  backend.setUser(TEST_USER_ID);
  backend.db.seedAll(buildTables(options));

  return backend;
}

/** Re-exported so specs can build fixture rows without a deep import. */
export { aLesson, aStage, aVocabularyWord, aWordReview };
