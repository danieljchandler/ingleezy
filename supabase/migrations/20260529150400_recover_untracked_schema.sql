-- Schema the 29 May security migrations need, dated to arrive just before them.
--
-- Two tables here exist in production but in no migration: both were created
-- through the platform dashboard rather than by an authored migration, so a
-- database rebuilt from this repo never had them. That is not cosmetic: the
-- next two migrations both reference them, and psql stops the file at the
-- first error, so each one aborted partway and everything below the reference
-- was silently never applied on a fresh environment —
--
--   20260529150401 stopped at section 8, stranding section 9 (drafts hidden
--   from non-admins on `lessons`) and section 10 (REVOKE EXECUTE on
--   `is_admin` / `is_recorder` / `has_role` from anon and authenticated).
--   Both are security posture, not features.
--
--   20260529155315 stopped on its first statement, stranding every
--   `storage.objects` delete policy in it — tutor-audio-clips and meme-uploads
--   would have had no DELETE policy at all on a rebuilt database.
--
-- So this file is dated to sort *before* them: with the tables present the two
-- migrations replay as authored, top to bottom, and nothing downstream is
-- stranded. Everything here is `IF NOT EXISTS`, so against the database these
-- tables already live in it is a no-op. Applying it to that database needs
-- `supabase db push --include-all`, because its version is older than the
-- migrations already recorded there — the alternative was editing two
-- historical files, and a no-op insert into history is the smaller lie.
--
-- Shapes come from `src/integrations/supabase/types.ts`, which is generated
-- from the real database: nullability and defaults are read off `Insert` vs
-- `Row`, and `Relationships: []` on both is why neither `user_id` nor any
-- other column carries a foreign key here. Production has none; adding one
-- would be inventing schema rather than recording it.

-- ─── processed_videos ────────────────────────────────────────────────────────
-- Transcription cache, keyed by "{platform}:{video_id}". `download-media` reads
-- it with `.eq('content_hash', …).maybeSingle()`, which errors outright on a
-- second row, so the uniqueness below is load-bearing rather than decorative.
CREATE TABLE IF NOT EXISTS public.processed_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash text NOT NULL,
  original_url text NOT NULL,
  platform text NOT NULL,
  video_id text NOT NULL,
  transcription_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_engines text[],
  source_language text,
  dialect text,
  duration_seconds integer,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS processed_videos_content_hash_key
  ON public.processed_videos (content_hash);

ALTER TABLE public.processed_videos ENABLE ROW LEVEL SECURITY;

-- ─── review_streaks ──────────────────────────────────────────────────────────
-- One row per learner. Every reader uses `.eq("user_id", …).maybeSingle()`, and
-- `grant_achievement`'s `streak_days` branch does the same in SQL, so the
-- one-row-per-user rule is the table's whole contract.
CREATE TABLE IF NOT EXISTS public.review_streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_review_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS review_streaks_user_id_key
  ON public.review_streaks (user_id);

-- RLS and the four owner policies are 20260529155315's job, immediately after
-- this file. Enabling it here as well would leave the table readable by nobody
-- for the width of one migration, which is harmless, but it also means two
-- files own the same decision.

-- No `updated_at` triggers on either table, deliberately. Nothing in the app
-- reads `updated_at` on them — `download-media` ages the cache off
-- `processed_at` — and the platform-created originals cannot be shown to have
-- one. A trigger here would be invented behaviour dressed as a recovered fact.

-- ─── lessons.status, hoisted ─────────────────────────────────────────────────
-- Not a missing table but the same shape of problem, and it only became visible
-- once the two above stopped aborting 20260529150401 early: its section 9
-- replaces "Anyone can view lessons" with a policy predicated on
-- `status = 'published'`, and nothing had created that column yet. The column
-- was recovered — correctly — by 20260816090000_recover_stranded_schema.sql,
-- but that is three months of history too late to help the policy that needs
-- it. Adding it here as well puts it in reach at the point of use; both
-- statements are `IF NOT EXISTS`, so whichever runs second does nothing, and
-- the recovery migration keeps its own record of why the column was missing.
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
