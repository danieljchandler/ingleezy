-- 1. review_streaks RLS
ALTER TABLE public.review_streaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own streaks" ON public.review_streaks;
DROP POLICY IF EXISTS "Users can insert their own streaks" ON public.review_streaks;
DROP POLICY IF EXISTS "Users can update their own streaks" ON public.review_streaks;
DROP POLICY IF EXISTS "Users can delete their own streaks" ON public.review_streaks;

CREATE POLICY "Users can view their own streaks"
  ON public.review_streaks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own streaks"
  ON public.review_streaks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own streaks"
  ON public.review_streaks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own streaks"
  ON public.review_streaks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 2. Storage delete ownership
DROP POLICY IF EXISTS "Users can delete their own tutor audio clips" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own meme uploads" ON storage.objects;

CREATE POLICY "Users can delete their own tutor audio clips"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'tutor-audio-clips' AND auth.uid() = owner);

CREATE POLICY "Users can delete their own meme uploads"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'meme-uploads' AND auth.uid() = owner);

-- Admins retain full delete rights across these buckets
CREATE POLICY "Admins can delete tutor audio clips"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'tutor-audio-clips' AND public.is_admin());

CREATE POLICY "Admins can delete meme uploads"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'meme-uploads' AND public.is_admin());