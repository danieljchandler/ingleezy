ALTER TABLE public.daily_vocab_stories ADD COLUMN IF NOT EXISTS sentences jsonb;
ALTER TABLE public.vocabulary_words ADD COLUMN IF NOT EXISTS root text;