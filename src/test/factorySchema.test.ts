import { describe, expect, it } from "vitest";
import * as factories from "./support/factories";
import { getTable } from "./support/postgrest/schema";
import type { Row } from "./support/postgrest/types";

/**
 * Every column a fixture invents is a test that passes for the wrong reason.
 *
 * This has now caught two real cases. `aDiscoverVideo` set `is_published` where
 * the column is `published`, so the query's filter matched nothing and the
 * listening task read as "no clips available" — a plausible-looking result that
 * had nothing to do with the code under test. Separately the subscription
 * persona returned `subscription_tier` where the function returns `tier`, so
 * every persona looked free-tier.
 *
 * Both are the same shape: a fixture that does not match the schema produces a
 * green test describing something that cannot happen. The in-memory backend
 * rejects unknown columns on *read*, but a fixture only has to be wrong on
 * write to disappear from a filtered query.
 *
 * So: every factory is built with its defaults and checked, column by column,
 * against the generated types.
 */

/** Which table each factory builds a row for. */
const FACTORY_TABLES: Record<string, string> = {
  aProfile: "profiles",
  aRole: "user_roles",
  aUserXp: "user_xp",
  aReviewStreak: "review_streaks",
  aWeeklyGoal: "weekly_goals",
  aStage: "curriculum_stages",
  aLesson: "lessons",
  aTopic: "topics",
  aVocabularyWord: "vocabulary_words",
  aWordReview: "word_reviews",
  aLessonProgress: "lesson_progress",
  aUserVocabulary: "user_vocabulary",
  aUserPhrase: "user_phrases",
  aSetPhrase: "set_phrases",
  aSetPhraseOccasion: "set_phrase_occasions",
  aUserSetPhrase: "user_set_phrases",
  aLearnerError: "learner_errors",
  aConceptMastery: "user_concept_mastery",
  aCurriculumConcept: "curriculum_concepts",
  aConceptLink: "content_concept_links",
  aFeatureMetric: "feature_metrics",
  aBibleLesson: "bible_lessons",
  aDialectRule: "dialect_rules",
  anMsaRule: "msa_transformation_rules",
  anAlert: "feature_alerts",
  aCurriculumChatSession: "curriculum_chat_sessions",
  aCurriculumChatMessage: "curriculum_chat_messages",
  aStoryScene: "story_scenes",
  aDailyChallenge: "daily_challenges",
  aVocabGameSet: "vocab_game_sets",
  aListeningExercise: "listening_exercises",
  aVocabBattle: "vocab_battles",
  aSavedTranscription: "saved_transcriptions",
  aChallengeCompletion: "daily_challenge_completions",
  aNativeReview: "dialect_native_reviews",
  aDiscoverVideo: "discover_videos",
  aTrendingCandidate: "trending_video_candidates",
  aListenEpisode: "listen_episodes",
  anAuthenticStory: "authentic_stories",
  anAuthenticStoryLine: "authentic_story_lines",
  anInteractiveStory: "interactive_stories",
  anInviteCode: "invite_codes",
};

/**
 * `subscribers` is deliberately absent from FACTORY_TABLES: it exists in
 * production but in no migration, so it has no generated type to check against.
 * See src/test/schemaContract.test.ts.
 */
const UNCHECKABLE = new Set(["aSubscriber"]);

type FactoryFn = (over?: Row) => Row;

describe("factories match the schema", () => {
  it("maps every exported factory to a table", () => {
    // A new factory with no entry here would go unchecked, which is how the
    // last two slipped through.
    const exported = Object.entries(factories)
      .filter(([name, value]) => typeof value === "function" && /^an?[A-Z]/.test(name))
      .map(([name]) => name);

    const unmapped = exported.filter(
      (name) => !(name in FACTORY_TABLES) && !UNCHECKABLE.has(name),
    );

    expect(
      unmapped,
      `These factories are not checked against the schema. Add them to ` +
        `FACTORY_TABLES, or to UNCHECKABLE with a reason.`,
    ).toEqual([]);
  });

  for (const [factoryName, tableName] of Object.entries(FACTORY_TABLES)) {
    it(`${factoryName} only sets columns that exist on ${tableName}`, () => {
      const factory = (factories as unknown as Record<string, FactoryFn>)[factoryName];
      expect(factory, `${factoryName} is not exported`).toBeTypeOf("function");

      const table = getTable(tableName);
      expect(table, `${tableName} is not in the generated types`).toBeDefined();

      const row = factory();
      const unknown = Object.keys(row).filter((column) => !table?.columns.has(column));

      expect(
        unknown,
        `${factoryName} sets columns ${tableName} does not have. A fixture that ` +
          `invents a column silently fails the query's filter, and the test ` +
          `reads as "no rows" rather than as a broken fixture.`,
      ).toEqual([]);
    });
  }

  for (const [factoryName, tableName] of Object.entries(FACTORY_TABLES)) {
    it(`${factoryName} sets everything ${tableName} requires`, () => {
      // A missing NOT NULL column makes the in-memory backend reject the
      // insert, which surfaces as a confusing write failure rather than a
      // fixture problem.
      const factory = (factories as unknown as Record<string, FactoryFn>)[factoryName];
      const table = getTable(tableName);
      const row = factory();

      const missing = [...(table?.requiredOnInsert ?? [])].filter(
        (column) => row[column] === undefined,
      );

      expect(missing, `${factoryName} omits required columns of ${tableName}`).toEqual([]);
    });
  }
});
