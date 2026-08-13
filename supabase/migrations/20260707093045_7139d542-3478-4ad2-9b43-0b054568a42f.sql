ALTER TABLE public.authentic_stories
  ADD COLUMN IF NOT EXISTS story_video_url text,
  ADD COLUMN IF NOT EXISTS story_video_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS story_video_operation text,
  ADD COLUMN IF NOT EXISTS story_video_error text;

DO $$ BEGIN
  CREATE POLICY "Public can read story videos"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'story-videos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;