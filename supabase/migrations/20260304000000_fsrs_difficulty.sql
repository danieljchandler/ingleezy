-- FSRS-4.5 migration: add difficulty column to all SRS tables
--
-- FSRS requires two state variables per card:
--   stability  → stored in existing ease_factor column
--   difficulty → new column (1.0–10.0, default 5.0 midpoint)
--
-- Existing ease_factor values (SM-2 ease factors, ~1.3–2.5) are left as-is;
-- they will be treated as initial stability values on the next review.
-- FSRS stability for a new "Good" card is 3.13, so existing values are in
-- a compatible range — users will not notice any disruption to their schedule.

ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS difficulty NUMERIC NOT NULL DEFAULT 5.0;

ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS difficulty NUMERIC NOT NULL DEFAULT 5.0;

ALTER TABLE public.user_phrases
  ADD COLUMN IF NOT EXISTS difficulty NUMERIC NOT NULL DEFAULT 5.0;
