
-- Enums
DO $$ BEGIN
  CREATE TYPE public.concept_kind AS ENUM ('vocab','grammar','theme','scenario','phrase');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.concept_role AS ENUM ('introduce','reinforce','assess');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mastery_strength AS ENUM ('new','learning','familiar','strong','mastered');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- curriculum_concepts
CREATE TABLE public.curriculum_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.concept_kind NOT NULL,
  key text NOT NULL,
  display_arabic text,
  display_english text,
  dialect text NOT NULL DEFAULT 'Gulf',
  cefr_level text,
  stage_id uuid,
  source_type text,
  source_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_introduced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key, dialect)
);
CREATE INDEX idx_concepts_dialect_cefr ON public.curriculum_concepts(dialect, cefr_level);
CREATE INDEX idx_concepts_kind ON public.curriculum_concepts(kind);

ALTER TABLE public.curriculum_concepts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage concepts" ON public.curriculum_concepts
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Authenticated can read concepts" ON public.curriculum_concepts
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_concepts_updated
  BEFORE UPDATE ON public.curriculum_concepts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- content_concept_links
CREATE TABLE public.content_concept_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL REFERENCES public.curriculum_concepts(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  content_id uuid NOT NULL,
  role public.concept_role NOT NULL DEFAULT 'introduce',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, content_type, content_id, role)
);
CREATE INDEX idx_links_concept ON public.content_concept_links(concept_id);
CREATE INDEX idx_links_content ON public.content_concept_links(content_type, content_id);
CREATE INDEX idx_links_created ON public.content_concept_links(created_at DESC);

ALTER TABLE public.content_concept_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage links" ON public.content_concept_links
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Authenticated can read links" ON public.content_concept_links
  FOR SELECT TO authenticated USING (true);

-- user_concept_mastery
CREATE TABLE public.user_concept_mastery (
  user_id uuid NOT NULL,
  concept_id uuid NOT NULL REFERENCES public.curriculum_concepts(id) ON DELETE CASCADE,
  exposures integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  incorrect integer NOT NULL DEFAULT 0,
  ease numeric NOT NULL DEFAULT 2.5,
  strength public.mastery_strength NOT NULL DEFAULT 'new',
  last_seen_at timestamptz,
  next_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, concept_id)
);
CREATE INDEX idx_mastery_user_due ON public.user_concept_mastery(user_id, next_due_at);
CREATE INDEX idx_mastery_concept ON public.user_concept_mastery(concept_id);

ALTER TABLE public.user_concept_mastery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own mastery" ON public.user_concept_mastery
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own mastery" ON public.user_concept_mastery
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own mastery" ON public.user_concept_mastery
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all mastery" ON public.user_concept_mastery
  FOR SELECT TO authenticated USING (is_admin());

CREATE TRIGGER trg_mastery_updated
  BEFORE UPDATE ON public.user_concept_mastery
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- curriculum_generation_log
CREATE TABLE public.curriculum_generation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid,
  dialect text NOT NULL DEFAULT 'Gulf',
  cefr text,
  stage_id uuid,
  content_type text,
  prompt_summary text,
  included_concepts uuid[] NOT NULL DEFAULT '{}',
  excluded_concepts uuid[] NOT NULL DEFAULT '{}',
  reinforced_concepts uuid[] NOT NULL DEFAULT '{}',
  model text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_genlog_created ON public.curriculum_generation_log(created_at DESC);
CREATE INDEX idx_genlog_dialect_cefr ON public.curriculum_generation_log(dialect, cefr);

ALTER TABLE public.curriculum_generation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage gen log" ON public.curriculum_generation_log
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
