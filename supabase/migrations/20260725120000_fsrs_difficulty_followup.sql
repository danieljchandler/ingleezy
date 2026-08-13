-- FSRS-4.5 difficulty follow-up
--
-- The original difficulty migration (20260304000000_fsrs_difficulty.sql) added a
-- `difficulty` column to word_reviews, user_vocabulary and user_phrases, but the
-- app never persisted it — every review recomputed the schedule with a constant
-- difficulty of 5.0, leaving the FSRS difficulty term inert. As we wire real
-- difficulty persistence through all decks, two SRS surfaces still lack a column:
--
--   1. user_vocabulary production cards track their own stability/interval/
--      repetitions (production_*), so they need their own production_difficulty.
--   2. user_set_phrases had no difficulty column at all.
--
-- Default 5.0 (the FSRS midpoint) matches how new cards initialise, so existing
-- rows keep their current schedule until their next review adapts difficulty.

ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS production_difficulty NUMERIC NOT NULL DEFAULT 5.0;

ALTER TABLE public.user_set_phrases
  ADD COLUMN IF NOT EXISTS difficulty NUMERIC NOT NULL DEFAULT 5.0;
