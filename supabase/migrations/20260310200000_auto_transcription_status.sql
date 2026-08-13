-- Add transcription_status to discover_videos for background pipeline tracking
-- Also add trending_candidate_id to link back to the trending candidate
ALTER TABLE discover_videos
  ADD COLUMN IF NOT EXISTS transcription_status text NOT NULL DEFAULT 'manual'
    CHECK (transcription_status IN ('manual', 'pending', 'processing', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS transcription_error text,
  ADD COLUMN IF NOT EXISTS trending_candidate_id uuid REFERENCES trending_video_candidates(id);

-- Index for quick lookup of pending/processing videos
CREATE INDEX IF NOT EXISTS idx_discover_videos_transcription_status
  ON discover_videos (transcription_status) WHERE transcription_status IN ('pending', 'processing');
