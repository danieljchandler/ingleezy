
-- Drop earlier public read policy if it was created
DROP POLICY IF EXISTS "Public can read feedback screenshots" ON storage.objects;

CREATE POLICY "Users can read own feedback screenshots"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'feedback-screenshots'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Admins can read all feedback screenshots"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'feedback-screenshots' AND public.is_admin());
