-- Add region_code to track which Gulf country the video was discovered from
-- Add duration_seconds to enable duration-based filtering in the UI
ALTER TABLE trending_video_candidates
  ADD COLUMN IF NOT EXISTS region_code text,
  ADD COLUMN IF NOT EXISTS duration_seconds integer;
