-- ============================================================
-- Hakiya content bridge: source tag on discover_videos
--
-- Bridged videos live in the SAME table as native uploads rather than a
-- parallel one, so every learner surface that already reads
-- discover_videos (Discover, the home-page lead clip, feeds) serves them
-- with zero UI changes. The tag is what lets those surfaces — and the
-- sync job — tell the two populations apart:
--
--   'native'  — uploaded and processed by this app (English videos)
--   'hakiya'  — snapshot-synced from Hakiya's public discover_videos
--               (Arabic dialect speech with English + Fusha transcript
--               lines). Read-only here: local edits are overwritten by
--               the next sync, by design — Hakiya is the source of truth
--               for its own content.
--
-- Sync is idempotent because rows keep Hakiya's UUID as their PK; the
-- sync function upserts on id. See sync-hakiya-videos.
-- ============================================================

ALTER TABLE public.discover_videos
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native'
    CHECK (source IN ('native', 'hakiya'));

CREATE INDEX IF NOT EXISTS idx_discover_videos_source
  ON public.discover_videos (source);
