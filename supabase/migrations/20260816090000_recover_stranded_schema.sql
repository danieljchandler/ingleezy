-- Recover the schema stranded behind three failing duplicate migrations.
--
-- The platform periodically re-emitted an already-authored migration under a
-- fresh hashed filename. Where the re-emission was byte-equivalent the extra
-- file was simply deleted. These three are not: they are *later* snapshots, so
-- each carries a little schema the authored original predates — and each dies
-- on its own first statement ("relation already exists"), taking everything
-- after it down with it.
--
-- The damage is invisible in the checks that exist. `migrationReplay` records
-- missing TABLES, and no table is missing; `schemaContract` reads the app's
-- queries against the committed types file, which describes the database as it
-- actually is rather than as the migrations rebuild it. A missing COLUMN falls
-- between the two. `lessons.dialect_module` is the sharp end: `useLessons`
-- filters every learner's curriculum on it, so on a rebuilt environment the
-- lesson list would fail outright.
--
-- Everything here is IF NOT EXISTS, so it is a no-op against a database that
-- already ran the snapshots — which is what the deleted duplicates prove is
-- the normal state. The three files are removed in the same commit, since with
-- their unique contributions recovered here they only add a failure.

-- ── lessons: the two columns the snapshot added and the app depends on ──────
--
-- Defaults match the snapshot exactly. `dialect_module` decides which learners
-- see a lesson at all; `status` is the draft/published gate the admin builder
-- writes and `useLessonImport` asserts on.
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS dialect_module text NOT NULL DEFAULT 'Gulf',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

-- ── The indexes that went down with them ────────────────────────────────────
--
-- Both back queries the app makes on every curriculum read: lessons by stage
-- (the overview) and lessons by dialect (the filter above).
CREATE INDEX IF NOT EXISTS idx_lessons_stage_id ON public.lessons(stage_id);
CREATE INDEX IF NOT EXISTS idx_lessons_dialect ON public.lessons(dialect_module);

-- Sessions are listed per admin, and only the failing snapshot indexed that.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_admin
  ON public.curriculum_chat_sessions(admin_id);

-- Deliberately NOT recovered: the snapshots' own table definitions. They are
-- looser than the authored ones — no CHECK constraints on `role`,
-- `approval_type` or `status`, no foreign keys from `curriculum_chat_approvals`
-- back to its message and session, and `vocabulary_words.lesson_id` as
-- ON DELETE SET NULL rather than CASCADE. The authored migrations run first and
-- win everywhere today; adopting the looser shapes would be a real schema
-- change wearing a cleanup's clothes.
