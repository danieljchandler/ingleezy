-- Content-library bridge: allow source = 'maktaba' on discover_videos.
--
-- 20260813160000_hakiya_bridge_source added `source` with
-- CHECK (source IN ('native', 'hakiya')). ingest-from-library (the receiving
-- end of Maktaba's dispatch) inserts source = 'maktaba', so every bridged
-- insert failed that check. Postgres cannot alter a CHECK in place, so drop
-- and recreate it with the third value; the constraint name is the one
-- Postgres gave the inline column check.

ALTER TABLE public.discover_videos
  DROP CONSTRAINT IF EXISTS discover_videos_source_check;

ALTER TABLE public.discover_videos
  ADD CONSTRAINT discover_videos_source_check
  CHECK (source IN ('native', 'hakiya', 'maktaba'));
