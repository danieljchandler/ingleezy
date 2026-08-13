ALTER TABLE public.discover_videos
  ADD COLUMN IF NOT EXISTS cefr_level text,
  ADD COLUMN IF NOT EXISTS difficulty_rationale text,
  ADD COLUMN IF NOT EXISTS difficulty_metrics jsonb;

ALTER TABLE public.discover_videos
  DROP CONSTRAINT IF EXISTS discover_videos_cefr_level_check;
ALTER TABLE public.discover_videos
  ADD CONSTRAINT discover_videos_cefr_level_check
  CHECK (cefr_level IS NULL OR cefr_level IN ('A1','A2','B1','B2','C1','C2'));

CREATE INDEX IF NOT EXISTS idx_discover_videos_cefr_level
  ON public.discover_videos (cefr_level);