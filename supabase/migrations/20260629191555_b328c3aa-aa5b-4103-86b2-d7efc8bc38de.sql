
ALTER TABLE public.beta_feedback ADD COLUMN IF NOT EXISTS screenshot_url text;

CREATE POLICY "Beta testers can upload feedback screenshots"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'feedback-screenshots'
  AND public.is_beta_tester()
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Public can read feedback screenshots"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'feedback-screenshots');

CREATE POLICY "Admins can delete feedback screenshots"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'feedback-screenshots' AND public.is_admin());
