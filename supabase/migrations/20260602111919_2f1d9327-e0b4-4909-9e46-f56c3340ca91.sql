ALTER TABLE public.user_vocabulary ADD COLUMN IF NOT EXISTS deck_name text;
CREATE INDEX IF NOT EXISTS idx_user_vocabulary_deck_name ON public.user_vocabulary(user_id, deck_name) WHERE deck_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_vocabulary_tags ON public.user_vocabulary USING GIN(tags) WHERE tags IS NOT NULL;