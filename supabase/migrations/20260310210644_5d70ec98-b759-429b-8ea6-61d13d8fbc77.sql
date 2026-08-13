ALTER TABLE discover_videos
  ADD COLUMN IF NOT EXISTS transcription_status text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS transcription_error text,
  ADD COLUMN IF NOT EXISTS trending_candidate_id uuid REFERENCES trending_video_candidates(id);

CREATE INDEX IF NOT EXISTS idx_discover_videos_transcription_status
  ON discover_videos (transcription_status) WHERE transcription_status IN ('pending', 'processing');