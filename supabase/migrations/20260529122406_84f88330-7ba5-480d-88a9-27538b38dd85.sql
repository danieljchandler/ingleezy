
-- ============================================================
-- 1. client_errors table for centralized error visibility
-- ============================================================
CREATE TABLE IF NOT EXISTS public.client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  source text NOT NULL DEFAULT 'client',        -- 'client' | 'edge'
  route text NULL,
  function_name text NULL,
  message text NOT NULL,
  stack text NULL,
  user_agent text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_errors_created_at ON public.client_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_errors_source ON public.client_errors (source);

GRANT INSERT ON public.client_errors TO anon;
GRANT INSERT, SELECT ON public.client_errors TO authenticated;
GRANT ALL ON public.client_errors TO service_role;

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. anonymous) may log an error. Message is capped client-side; this is a sink.
CREATE POLICY "Anyone can log errors"
ON public.client_errors FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Only admins can read errors.
CREATE POLICY "Admins can view errors"
ON public.client_errors FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can delete errors"
ON public.client_errors FOR DELETE
TO authenticated
USING (public.is_admin());

-- ============================================================
-- 2. Storage bucket lockdown
--    Public READ stays; WRITE is owner-scoped or admin-only.
--    Folder convention: <auth.uid()>/<filename>
-- ============================================================

-- Drop any prior lahja_* policies so this migration is idempotent.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND polname LIKE 'lahja_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.polname);
  END LOOP;
END $$;

-- --- Public read for all six buckets (single combined policy) ---
CREATE POLICY "lahja_public_read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id IN ('avatars','meme-uploads','flashcard-images','flashcard-audio','tutor-audio-clips','audio'));

-- --- User-scoped buckets: avatars, meme-uploads, tutor-audio-clips ---
-- Owner determined by first path segment matching auth.uid()
CREATE POLICY "lahja_owner_insert_user_buckets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('avatars','meme-uploads','tutor-audio-clips')
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "lahja_owner_update_user_buckets"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id IN ('avatars','meme-uploads','tutor-audio-clips')
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id IN ('avatars','meme-uploads','tutor-audio-clips')
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "lahja_owner_delete_user_buckets"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id IN ('avatars','meme-uploads','tutor-audio-clips')
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- --- Admin-only buckets: flashcard-images, flashcard-audio, audio ---
CREATE POLICY "lahja_admin_write_system_buckets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('flashcard-images','flashcard-audio','audio')
  AND public.is_admin()
);

CREATE POLICY "lahja_admin_update_system_buckets"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id IN ('flashcard-images','flashcard-audio','audio')
  AND public.is_admin()
)
WITH CHECK (
  bucket_id IN ('flashcard-images','flashcard-audio','audio')
  AND public.is_admin()
);

CREATE POLICY "lahja_admin_delete_system_buckets"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id IN ('flashcard-images','flashcard-audio','audio')
  AND public.is_admin()
);
