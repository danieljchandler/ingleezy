ALTER TABLE public.user_phrases ADD COLUMN IF NOT EXISTS dialect text NOT NULL DEFAULT 'Gulf';
CREATE INDEX IF NOT EXISTS idx_user_phrases_user_dialect ON public.user_phrases(user_id, dialect);