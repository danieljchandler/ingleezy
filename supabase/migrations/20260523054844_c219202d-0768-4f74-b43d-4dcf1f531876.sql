ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_leech boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mnemonic text;

ALTER TABLE public.user_phrases
  ADD COLUMN IF NOT EXISTS lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_leech boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mnemonic text,
  ADD COLUMN IF NOT EXISTS jingle_audio_url text;

CREATE INDEX IF NOT EXISTS idx_user_vocabulary_leech ON public.user_vocabulary (user_id, is_leech) WHERE is_leech = true;
CREATE INDEX IF NOT EXISTS idx_user_phrases_leech ON public.user_phrases (user_id, is_leech) WHERE is_leech = true;