ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS difficulty numeric NOT NULL DEFAULT 5.0;