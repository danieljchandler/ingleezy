
CREATE TABLE IF NOT EXISTS public.video_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  video_id UUID NOT NULL,
  watched_seconds INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  watched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, video_id)
);

ALTER TABLE public.video_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own video views"
ON public.video_views FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own video views"
ON public.video_views FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own video views"
ON public.video_views FOR UPDATE
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_video_views_user_watched ON public.video_views(user_id, watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_views_user_video ON public.video_views(user_id, video_id);

DROP TRIGGER IF EXISTS trg_video_views_updated_at ON public.video_views;
CREATE TRIGGER trg_video_views_updated_at
BEFORE UPDATE ON public.video_views
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
