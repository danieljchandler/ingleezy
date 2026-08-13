-- Add CHECK constraints to enforce difficulty values stay within FSRS 1.0–10.0 range.
-- Idempotent: each constraint is added inside a DO block that ignores duplicate_object errors.

DO $$ BEGIN
  ALTER TABLE public.word_reviews
    ADD CONSTRAINT word_reviews_difficulty_check CHECK (difficulty >= 1.0 AND difficulty <= 10.0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.user_vocabulary
    ADD CONSTRAINT user_vocabulary_difficulty_check CHECK (difficulty >= 1.0 AND difficulty <= 10.0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.user_phrases
    ADD CONSTRAINT user_phrases_difficulty_check CHECK (difficulty >= 1.0 AND difficulty <= 10.0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
