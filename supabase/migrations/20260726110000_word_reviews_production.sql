-- Give the curriculum deck a production schedule, plus lapse/leech tracking.
--
-- `user_vocabulary` (the personal deck) has had a full second FSRS track since
-- 20260513174044, so a mined word is tested both ways: Arabic → meaning, and
-- meaning → Arabic. `word_reviews` — the deck holding the *curriculum*, the
-- structured material every learner works through — never got it. The app's
-- core deck taught recognition only, in an app whose entire premise is speaking
-- the dialect. Recognition knowledge doesn't transfer to production on its own.
--
-- Columns mirror user_vocabulary exactly (same names, same defaults) so
-- src/lib/spacedRepetition.ts and the review pages can treat the two decks
-- identically. As there, FSRS stability is stored in *_ease_factor and
-- difficulty in *_difficulty.
--
-- production_next_review_at is nullable: NULL means "never studied in this
-- direction", which is what lets the review query serve production cards only
-- once the learner has some recognition footing.

ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS production_ease_factor numeric NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS production_difficulty numeric NOT NULL DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS production_interval_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_repetitions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_next_review_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS production_last_reviewed_at timestamptz NULL;

-- Recognition-side lapse/leech tracking, which this deck also lacked — so the
-- learner profile's "weak" set and the leech helper could only ever see mined
-- vocabulary, never curriculum words.
ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_leech boolean NOT NULL DEFAULT false;

-- Partial index matching the due query: production cards are a minority of rows
-- (only words the learner has graduated into production), so indexing the whole
-- table would be mostly dead weight.
CREATE INDEX IF NOT EXISTS idx_word_reviews_production_due
  ON public.word_reviews (user_id, production_next_review_at)
  WHERE production_next_review_at IS NOT NULL;
