-- Reading library direction flip: `title` and `passage` carry ENGLISH now
-- (the studied language — the reader and its tests already treat them so).
-- These columns add the Arabic scaffold an editorial passage can carry:
-- a dialect title, a dialect translation of the passage paired by sentence
-- position, and an optional authored per-line breakdown
-- [{english, arabic, literal}] that beats the position pairing when present.
-- The Arabic-era title_english/passage_english columns stay for old rows.

ALTER TABLE public.reading_passages
  ADD COLUMN IF NOT EXISTS title_arabic text,
  ADD COLUMN IF NOT EXISTS passage_arabic text,
  ADD COLUMN IF NOT EXISTS lines jsonb;
