/**
 * Columns the migrations create that `src/integrations/supabase/types.ts` does
 * not list.
 *
 * The generated types are stale. Found by replaying all 137 migrations against
 * a real Postgres and diffing the result against the file — 24 columns exist in
 * the database and are missing from the types.
 *
 * That matters beyond the test suite: TypeScript does not know these columns
 * exist, so any code touching one needs a cast, which is part of why the repo
 * carries several hundred `no-explicit-any` errors. `word_reviews.difficulty`
 * is the clearest case — FSRS stores a card's difficulty there and every
 * curriculum rating writes it, with the write typed as `never`.
 *
 * The fix is to regenerate the types, which needs Supabase access. Until then
 * the emulator has to accept these or it would reject writes the real database
 * accepts. Each entry names the migration that creates it, and
 * `src/test/typesDrift.test.ts` checks that claim — so this cannot quietly
 * become a place to excuse a genuine typo.
 */

export interface DriftedColumn {
  table: string;
  column: string;
  /** The migration file that creates it, without the `.sql`. */
  migration: string;
}

/** Everything the curriculum restructure added, in one migration. */
const CURRICULUM_RESTRUCTURE = "20260224000000_curriculum_restructure";

export const COLUMNS_MISSING_FROM_TYPES: DriftedColumn[] = [
  // FSRS-4.5 added difficulty to all three SRS tables; the types picked it up
  // for user_vocabulary and user_phrases but not for word_reviews.
  { table: "word_reviews", column: "difficulty", migration: "20260304000000_fsrs_difficulty" },




  // The lesson-content columns the curriculum builder writes.
  ...[
    "unlock_condition",
    "sound_spotlight",
    "lesson_sequence",
    "real_world_prompts",
    "design_rationale",
    "flashcard_spec",
    "image_scenes",
  ].map((column) => ({ table: "lessons", column, migration: CURRICULUM_RESTRUCTURE })),

  ...["transliteration", "category", "teaching_note", "image_scene_description"].map((column) => ({
    table: "vocabulary_words",
    column,
    migration: CURRICULUM_RESTRUCTURE,
  })),

  {
    table: "saved_transcriptions",
    column: "dialect_validation",
    migration: "20260228000000_dialect_validation",
  },
  {
    table: "curriculum_chat_approvals",
    column: "approved_at",
    migration: "20260304100000_curriculum_chat",
  },

  // Service-role-only telemetry tables, absent from the types entirely because
  // they carry no anon or authenticated grants.
  ...["id", "user_id", "endpoint", "created_at"].map((column) => ({
    table: "fanar_usage",
    column,
    migration: "20260226000000_fanar_usage",
  })),
];


/** Extra columns for a table, as a set. */
export function extraColumnsFor(table: string): string[] {
  return COLUMNS_MISSING_FROM_TYPES.filter((entry) => entry.table === table).map(
    (entry) => entry.column,
  );
}
