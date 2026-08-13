
ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS production_ease_factor numeric NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS production_interval_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_repetitions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_next_review_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS production_last_reviewed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_user_vocabulary_production_due
  ON public.user_vocabulary (user_id, dialect, production_next_review_at)
  WHERE production_next_review_at IS NOT NULL;
