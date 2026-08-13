
-- 1. Per-dialect uniqueness on user_vocabulary
ALTER TABLE public.user_vocabulary
  DROP CONSTRAINT IF EXISTS user_vocabulary_user_id_word_arabic_key;

ALTER TABLE public.user_vocabulary
  ADD CONSTRAINT user_vocabulary_user_word_dialect_key
  UNIQUE (user_id, word_arabic, dialect);

-- 2. picture_scenes
CREATE TABLE public.picture_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialect text NOT NULL DEFAULT 'Gulf',
  theme text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  title_arabic text NOT NULL DEFAULT '',
  description text,
  image_url text,
  cefr_level text,
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  session_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.picture_scenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published picture scenes"
  ON public.picture_scenes FOR SELECT
  USING (status = 'published' OR is_admin());

CREATE POLICY "Admins can insert picture scenes"
  ON public.picture_scenes FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update picture scenes"
  ON public.picture_scenes FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete picture scenes"
  ON public.picture_scenes FOR DELETE
  USING (is_admin());

CREATE TRIGGER update_picture_scenes_updated_at
  BEFORE UPDATE ON public.picture_scenes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_picture_scenes_dialect_status ON public.picture_scenes(dialect, status);
CREATE INDEX idx_picture_scenes_session ON public.picture_scenes(session_id);

-- 3. picture_scene_hotspots
CREATE TABLE public.picture_scene_hotspots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES public.picture_scenes(id) ON DELETE CASCADE,
  word_arabic text NOT NULL,
  word_english text NOT NULL DEFAULT '',
  root text,
  word_audio_url text,
  x_pct numeric,
  y_pct numeric,
  radius_pct numeric NOT NULL DEFAULT 8,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.picture_scene_hotspots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view hotspots of published scenes"
  ON public.picture_scene_hotspots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.picture_scenes s
      WHERE s.id = picture_scene_hotspots.scene_id
        AND (s.status = 'published' OR is_admin())
    )
  );

CREATE POLICY "Admins can insert hotspots"
  ON public.picture_scene_hotspots FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update hotspots"
  ON public.picture_scene_hotspots FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete hotspots"
  ON public.picture_scene_hotspots FOR DELETE
  USING (is_admin());

CREATE TRIGGER update_picture_scene_hotspots_updated_at
  BEFORE UPDATE ON public.picture_scene_hotspots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_picture_scene_hotspots_scene ON public.picture_scene_hotspots(scene_id);

-- 4. user_picture_scene_progress
CREATE TABLE public.user_picture_scene_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scene_id uuid NOT NULL REFERENCES public.picture_scenes(id) ON DELETE CASCADE,
  last_score integer NOT NULL DEFAULT 0,
  last_total integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  last_played_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scene_id)
);

ALTER TABLE public.user_picture_scene_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own scene progress"
  ON public.user_picture_scene_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scene progress"
  ON public.user_picture_scene_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scene progress"
  ON public.user_picture_scene_progress FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_user_picture_scene_progress_updated_at
  BEFORE UPDATE ON public.user_picture_scene_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_user_picture_scene_progress_user ON public.user_picture_scene_progress(user_id);
