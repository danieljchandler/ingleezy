
-- Interactive Stories table
CREATE TABLE public.interactive_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  title_arabic text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  description_arabic text NOT NULL DEFAULT '',
  dialect text NOT NULL DEFAULT 'Gulf',
  difficulty text NOT NULL DEFAULT 'Beginner',
  icon_name text NOT NULL DEFAULT 'BookOpen',
  cover_image_url text,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL,
  session_id uuid,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Story Scenes table (each scene is a node in the adventure)
CREATE TABLE public.story_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.interactive_stories(id) ON DELETE CASCADE,
  scene_order integer NOT NULL DEFAULT 0,
  narrative_arabic text NOT NULL DEFAULT '',
  narrative_english text NOT NULL DEFAULT '',
  vocabulary jsonb NOT NULL DEFAULT '[]'::jsonb,
  choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_ending boolean NOT NULL DEFAULT false,
  ending_message text,
  ending_message_arabic text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Story progress tracking
CREATE TABLE public.story_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  story_id uuid NOT NULL REFERENCES public.interactive_stories(id) ON DELETE CASCADE,
  current_scene_id uuid REFERENCES public.story_scenes(id) ON DELETE SET NULL,
  completed boolean NOT NULL DEFAULT false,
  path_taken jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(user_id, story_id)
);

-- Enable RLS
ALTER TABLE public.interactive_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_progress ENABLE ROW LEVEL SECURITY;

-- RLS: interactive_stories
CREATE POLICY "Anyone can view published stories" ON public.interactive_stories
  FOR SELECT USING (status = 'published' OR is_admin());

CREATE POLICY "Admins can insert stories" ON public.interactive_stories
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "Admins can update stories" ON public.interactive_stories
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admins can delete stories" ON public.interactive_stories
  FOR DELETE USING (is_admin());

-- RLS: story_scenes
CREATE POLICY "Anyone can view scenes of published stories" ON public.story_scenes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.interactive_stories s
      WHERE s.id = story_scenes.story_id
      AND (s.status = 'published' OR is_admin())
    )
  );

CREATE POLICY "Admins can insert scenes" ON public.story_scenes
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "Admins can update scenes" ON public.story_scenes
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admins can delete scenes" ON public.story_scenes
  FOR DELETE USING (is_admin());

-- RLS: story_progress
CREATE POLICY "Users can view their own progress" ON public.story_progress
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own progress" ON public.story_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own progress" ON public.story_progress
  FOR UPDATE USING (auth.uid() = user_id);

-- Updated_at triggers
CREATE TRIGGER update_interactive_stories_updated_at
  BEFORE UPDATE ON public.interactive_stories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_story_scenes_updated_at
  BEFORE UPDATE ON public.story_scenes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
