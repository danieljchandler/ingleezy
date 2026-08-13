-- ============================================================
-- Curriculum Restructure Migration
-- Adds curriculum_stages and lessons tables.
-- Migrates existing topics → lessons.
-- Adds lesson_id + new columns to vocabulary_words.
-- ============================================================

-- 1. Create curriculum_stages table
CREATE TABLE public.curriculum_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_arabic TEXT,
  stage_number INTEGER NOT NULL UNIQUE,
  cefr_level TEXT,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.curriculum_stages ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Anyone can view curriculum stages"
ON public.curriculum_stages FOR SELECT
TO anon, authenticated
USING (true);

-- Admin write
CREATE POLICY "Admins can insert curriculum stages"
ON public.curriculum_stages FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update curriculum stages"
ON public.curriculum_stages FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete curriculum stages"
ON public.curriculum_stages FOR DELETE
TO authenticated
USING (public.is_admin());

CREATE TRIGGER update_curriculum_stages_updated_at
BEFORE UPDATE ON public.curriculum_stages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Create lessons table
CREATE TABLE public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id UUID REFERENCES public.curriculum_stages(id) ON DELETE CASCADE NOT NULL,
  lesson_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_arabic TEXT,
  description TEXT,
  duration_minutes INTEGER,
  cefr_target TEXT,
  approach TEXT,
  unlock_condition TEXT,
  icon TEXT NOT NULL DEFAULT '📚',
  gradient TEXT NOT NULL DEFAULT 'bg-gradient-green',
  display_order INTEGER NOT NULL DEFAULT 0,
  -- Lesson plan metadata stored as JSONB (from xlsx import)
  lesson_sequence JSONB DEFAULT '[]'::jsonb,
  image_scenes JSONB DEFAULT '[]'::jsonb,
  flashcard_spec JSONB DEFAULT '[]'::jsonb,
  real_world_prompts JSONB DEFAULT '[]'::jsonb,
  design_rationale JSONB DEFAULT '[]'::jsonb,
  sound_spotlight JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(stage_id, lesson_number)
);

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Anyone can view lessons"
ON public.lessons FOR SELECT
TO anon, authenticated
USING (true);

-- Admin write
CREATE POLICY "Admins can insert lessons"
ON public.lessons FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update lessons"
ON public.lessons FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete lessons"
ON public.lessons FOR DELETE
TO authenticated
USING (public.is_admin());

CREATE TRIGGER update_lessons_updated_at
BEFORE UPDATE ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Add new columns to vocabulary_words
ALTER TABLE public.vocabulary_words
  ADD COLUMN lesson_id UUID REFERENCES public.lessons(id) ON DELETE CASCADE,
  ADD COLUMN transliteration TEXT,
  ADD COLUMN category TEXT,
  ADD COLUMN image_scene_description TEXT,
  ADD COLUMN teaching_note TEXT;

-- Index for lesson-based lookups
CREATE INDEX idx_vocabulary_words_lesson_id ON public.vocabulary_words(lesson_id);

-- 4. Seed the 6 curriculum stages from the Lahja curriculum document
INSERT INTO public.curriculum_stages (name, name_arabic, stage_number, cefr_level, description, display_order) VALUES
  ('Foundations', 'الأسس', 1, 'Pre-A1 → A1', 'Read Arabic script, produce Gulf sounds, use 50+ survival phrases. Duration: 4–6 weeks (15–20 min/day).', 1),
  ('Building Blocks', 'اللبنات', 2, 'A1 → A2', 'Construct basic sentences, understand slow Gulf speech, 500+ word vocabulary. Duration: 8–12 weeks (20–30 min/day).', 2),
  ('The Bridge', 'الجسر', 3, 'A2 → B1', 'Follow authentic Gulf content with scaffolding, converse on familiar topics, 1,500+ words. Duration: 8–16 weeks (25–40 min/day).', 3),
  ('Immersion', 'الانغماس', 4, 'B1 → B2', 'Primary learning through authentic content, express opinions, 3,000+ words. Duration: 12–20 weeks (30–45 min/day).', 4),
  ('Fluency', 'الطلاقة', 5, 'B2 → C1', 'Follow complex discussions, understand rapid speech and slang, 5,000+ words. Duration: 16–24 weeks (30–60 min/day).', 5),
  ('Mastery', 'الإتقان', 6, 'C1 → C2', 'Near-native comprehension, cultural fluency, register shifting between formal and colloquial. Ongoing.', 6);

-- 5. Migrate existing topics into lessons under a "Legacy Topics" stage
-- Only do this if topics exist
DO $$
DECLARE
  legacy_stage_id UUID;
  topic_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO topic_count FROM public.topics;

  IF topic_count > 0 THEN
    -- Create a stage 0 for legacy content
    INSERT INTO public.curriculum_stages (name, name_arabic, stage_number, cefr_level, description, display_order)
    VALUES ('Legacy Topics', 'المواضيع القديمة', 0, NULL, 'Vocabulary organized by topic from before curriculum restructuring.', 0)
    RETURNING id INTO legacy_stage_id;

    -- Create a lesson for each existing topic
    INSERT INTO public.lessons (stage_id, lesson_number, title, title_arabic, icon, gradient, display_order)
    SELECT
      legacy_stage_id,
      t.display_order + 1,
      t.name,
      t.name_arabic,
      t.icon,
      t.gradient,
      t.display_order
    FROM public.topics t
    ORDER BY t.display_order;

    -- Link existing vocabulary_words to their new lesson
    UPDATE public.vocabulary_words vw
    SET lesson_id = l.id
    FROM public.topics t
    JOIN public.lessons l ON l.title = t.name
      AND l.stage_id = legacy_stage_id
    WHERE vw.topic_id = t.id;
  END IF;
END $$;
