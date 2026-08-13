ALTER TABLE public.user_vocabulary ADD COLUMN IF NOT EXISTS jingle_lyrics TEXT;
ALTER TABLE public.user_phrases ADD COLUMN IF NOT EXISTS jingle_lyrics TEXT;