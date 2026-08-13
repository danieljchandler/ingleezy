-- Add UPDATE policy for video-audio bucket (allows admin re-uploads/upserts)
CREATE POLICY "Admins can update video-audio files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'video-audio' AND public.is_admin())
WITH CHECK (bucket_id = 'video-audio' AND public.is_admin());

-- Add DELETE policy for video-audio bucket (allows cleanup of stale files)
CREATE POLICY "Admins can delete video-audio files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'video-audio' AND public.is_admin());