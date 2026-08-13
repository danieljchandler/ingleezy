
-- Create curriculum_stages table
CREATE TABLE public.curriculum_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_number integer NOT NULL,
  name text NOT NULL,
  name_arabic text,
  cefr_level text,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.curriculum_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view stages" ON public.curriculum_stages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can manage stages" ON public.curriculum_stages FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Create lessons table
CREATE TABLE public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.curriculum_stages(id) ON DELETE CASCADE,
  lesson_number integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  title_arabic text,
  description text,
  duration_minutes integer,
  cefr_target text,
  approach text,
  icon text NOT NULL DEFAULT '📚',
  gradient text NOT NULL DEFAULT 'bg-gradient-green',
  display_order integer NOT NULL DEFAULT 0,
  dialect_module text NOT NULL DEFAULT 'Gulf',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view lessons" ON public.lessons FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can manage lessons" ON public.lessons FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Create curriculum_chat_approvals table
CREATE TABLE public.curriculum_chat_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  session_id uuid NOT NULL,
  approval_type text NOT NULL,
  target_lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  approved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.curriculum_chat_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage approvals" ON public.curriculum_chat_approvals FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Add lesson_id to vocabulary_words
ALTER TABLE public.vocabulary_words ADD COLUMN IF NOT EXISTS lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lessons_stage_id ON public.lessons(stage_id);
CREATE INDEX IF NOT EXISTS idx_lessons_dialect ON public.lessons(dialect_module);
CREATE INDEX IF NOT EXISTS idx_vocab_lesson_id ON public.vocabulary_words(lesson_id);

-- Seed the 6 curriculum stages
INSERT INTO public.curriculum_stages (stage_number, name, name_arabic, cefr_level, description, display_order) VALUES
  (1, 'Foundations', 'الأساسيات', 'Pre-A1 → A1', '50+ survival phrases, Arabic script, Gulf sounds', 1),
  (2, 'Building Blocks', 'اللبنات', 'A1 → A2', 'Basic sentences, slow Gulf speech, 500+ words', 2),
  (3, 'The Bridge', 'الجسر', 'A2 → B1', 'Authentic content with scaffolding, 1500+ words', 3),
  (4, 'Immersion', 'الانغماس', 'B1 → B2', 'Primary learning through authentic content, 3000+ words', 4),
  (5, 'Fluency', 'الطلاقة', 'B2 → C1', 'Complex discussions, rapid speech, 5000+ words', 5),
  (6, 'Mastery', 'الإتقان', 'C1 → C2', 'Near-native comprehension, cultural fluency', 6);
