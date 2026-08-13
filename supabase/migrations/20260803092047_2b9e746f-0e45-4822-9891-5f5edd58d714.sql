ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS difficulty NUMERIC NOT NULL DEFAULT 5.0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_vocabulary_difficulty_check'
      AND conrelid = 'public.user_vocabulary'::regclass
  ) THEN
    ALTER TABLE public.user_vocabulary
      ADD CONSTRAINT user_vocabulary_difficulty_check
      CHECK (difficulty >= 1.0 AND difficulty <= 10.0);
  END IF;
END
$$;