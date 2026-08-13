-- Per-learner lesson progress.
--
-- The curriculum has been invisible: `useLessons`/`useStages` are referenced only
-- by admin pages, nothing links to /learn/:lessonId, and there was no record
-- anywhere of which lessons a learner had finished. `lessons.unlock_condition`
-- has existed since the curriculum restructure and is read by nothing.
--
-- "Continue where you left off" was a single localStorage entry with a 7-day TTL
-- (src/lib/continueProgress.ts) — one lesson at a time, gone on a device change.
-- That stays as the fast local path; this table is the durable one.

CREATE TABLE public.lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  -- Resume position and how far through the learner got.
  last_word_index integer NOT NULL DEFAULT 0,
  words_seen integer NOT NULL DEFAULT 0,
  words_total integer NOT NULL DEFAULT 0,
  -- Best quiz percentage across attempts, so a re-run can't lower a good score.
  best_score numeric,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

-- The read pattern is "all progress for this user", joined against the lesson
-- list on the curriculum page.
CREATE INDEX idx_lesson_progress_user ON public.lesson_progress (user_id);

GRANT SELECT, INSERT, UPDATE ON public.lesson_progress TO authenticated;
GRANT ALL ON public.lesson_progress TO service_role;

ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own lesson progress"
  ON public.lesson_progress
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own lesson progress"
  ON public.lesson_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lesson progress"
  ON public.lesson_progress
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
