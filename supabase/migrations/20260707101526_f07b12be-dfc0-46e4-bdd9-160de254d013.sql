
ALTER TABLE public.authentic_stories
  ADD COLUMN IF NOT EXISTS story_video_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS story_video_full_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS story_video_full_error text,
  ADD COLUMN IF NOT EXISTS story_video_approved boolean NOT NULL DEFAULT false;
