-- generate-daily-story now asks the model for a dialect-aware transliteration
-- of body_arabic (matching generate-story's narrative_transliteration and
-- reading-passage's per-line transliteration) so the story surface isn't the
-- only major generator without one.
ALTER TABLE public.daily_vocab_stories
  ADD COLUMN body_transliteration text;
