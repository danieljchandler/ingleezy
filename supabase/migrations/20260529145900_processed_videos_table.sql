-- processed_videos: the transcription cache download-media consults by
-- content_hash before paying for a re-download. Like review_streaks, it
-- existed only in production — a platform-made table the migrations never
-- carried — and was half of why 20260529150401 could not replay from scratch.
-- Shape taken from the generated types, which record production's columns.
-- IF NOT EXISTS throughout, so replaying against the real database is a no-op.
CREATE TABLE IF NOT EXISTS public.processed_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id text NOT NULL,
  original_url text NOT NULL,
  platform text NOT NULL,
  content_hash text NOT NULL,
  dialect text,
  duration_seconds integer,
  source_language text,
  processing_engines text[],
  transcription_data jsonb NOT NULL DEFAULT '{}',
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The cache key. In this repo nothing writes the table any more (the reader
-- in download-media does .maybeSingle() on it), so the unique index cannot
-- collide with existing rows on a rebuilt database.
CREATE UNIQUE INDEX IF NOT EXISTS processed_videos_content_hash_key
  ON public.processed_videos (content_hash);
