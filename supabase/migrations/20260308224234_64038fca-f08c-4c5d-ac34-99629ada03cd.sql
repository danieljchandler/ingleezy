
CREATE TABLE public.video_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (video_id, user_id)
);

ALTER TABLE public.video_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ratings"
  ON public.video_ratings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all ratings"
  ON public.video_ratings FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Users can insert their own ratings"
  ON public.video_ratings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ratings"
  ON public.video_ratings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
