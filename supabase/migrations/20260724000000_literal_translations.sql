-- Literal (word-for-word) translations alongside natural ones.
-- These columns are optional and nullable; existing rows keep NULL and the UI
-- simply doesn't show a literal gloss for them.

ALTER TABLE public.story_scenes
  ADD COLUMN IF NOT EXISTS narrative_literal text;

ALTER TABLE public.daily_vocab_stories
  ADD COLUMN IF NOT EXISTS body_english_literal text;

ALTER TABLE public.authentic_story_lines
  ADD COLUMN IF NOT EXISTS english_literal text;

ALTER TABLE public.set_phrases
  ADD COLUMN IF NOT EXISTS phrase_literal text;

ALTER TABLE public.set_phrases
  ADD COLUMN IF NOT EXISTS reply_literal text;
