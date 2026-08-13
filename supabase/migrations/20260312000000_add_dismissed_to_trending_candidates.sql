-- Add dismissed column to trending_video_candidates.
-- Dismissed videos are soft-deleted: hidden from all views but kept in DB
-- so their video_id stays in the unique index and prevents re-insertion on future fetches.
ALTER TABLE trending_video_candidates
  ADD COLUMN IF NOT EXISTS dismissed boolean NOT NULL DEFAULT false;
