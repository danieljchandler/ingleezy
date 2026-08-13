ALTER TABLE public.discover_videos
  ADD COLUMN IF NOT EXISTS engines_used jsonb;