
-- Create video-audio storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('video-audio', 'video-audio', false)
ON CONFLICT (id) DO NOTHING;

-- Allow admins to upload to video-audio bucket
CREATE POLICY "Admins can upload video audio"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'video-audio'
  AND public.is_admin()
);

-- Allow admins to read from video-audio bucket
CREATE POLICY "Admins can read video audio"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'video-audio'
  AND public.is_admin()
);

-- Allow service role (edge functions) to read video-audio
-- Service role bypasses RLS, so no policy needed for that.
