ALTER TABLE public.user_phrases
  ADD COLUMN IF NOT EXISTS difficulty numeric NOT NULL DEFAULT 5;

CREATE INDEX IF NOT EXISTS idx_user_phrases_due
  ON public.user_phrases (user_id, next_review_at);