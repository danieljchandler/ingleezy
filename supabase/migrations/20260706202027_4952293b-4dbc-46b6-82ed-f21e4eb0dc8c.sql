
-- Reading Library: authentic Arabic stories + per-line rows
-- Backfill migration for code merged from GitHub

CREATE TABLE IF NOT EXISTS public.authentic_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  title_arabic text,
  author text,
  author_arabic text,
  source_url text,
  source_name text,
  license text NOT NULL DEFAULT 'public_domain',
  body_fusha text,
  body_fusha_vocalized text,
  body_english text,
  body_dialect text,
  body_dialect_vocalized text,
  dialect text NOT NULL DEFAULT 'Gulf',
  difficulty text NOT NULL DEFAULT 'intermediate',
  vocabulary jsonb,
  status text NOT NULL DEFAULT 'draft',
  video_status text NOT NULL DEFAULT 'none',
  video_preview_url text,
  audio_url text,
  duration_seconds numeric,
  line_durations jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.authentic_stories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentic_stories TO authenticated;
GRANT ALL ON public.authentic_stories TO service_role;

ALTER TABLE public.authentic_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published authentic stories"
  ON public.authentic_stories FOR SELECT
  USING (status = 'published');

CREATE POLICY "Content managers can view all authentic stories"
  ON public.authentic_stories FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'));

CREATE POLICY "Content managers can insert authentic stories"
  ON public.authentic_stories FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'));

CREATE POLICY "Content managers can update authentic stories"
  ON public.authentic_stories FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'));

CREATE POLICY "Content managers can delete authentic stories"
  ON public.authentic_stories FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'));

CREATE INDEX IF NOT EXISTS authentic_stories_status_idx ON public.authentic_stories(status);
CREATE INDEX IF NOT EXISTS authentic_stories_dialect_idx ON public.authentic_stories(dialect);


CREATE TABLE IF NOT EXISTS public.authentic_story_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.authentic_stories(id) ON DELETE CASCADE,
  line_index integer NOT NULL,
  arabic text NOT NULL,
  arabic_vocalized text,
  english text,
  dialect text,
  dialect_vocalized text,
  audio_url text,
  duration_seconds numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, line_index)
);

GRANT SELECT ON public.authentic_story_lines TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentic_story_lines TO authenticated;
GRANT ALL ON public.authentic_story_lines TO service_role;

ALTER TABLE public.authentic_story_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view lines of published stories"
  ON public.authentic_story_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.authentic_stories s
    WHERE s.id = authentic_story_lines.story_id AND s.status = 'published'
  ));

CREATE POLICY "Content managers can view all story lines"
  ON public.authentic_story_lines FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'));

CREATE POLICY "Content managers can insert story lines"
  ON public.authentic_story_lines FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'));

CREATE POLICY "Content managers can update story lines"
  ON public.authentic_story_lines FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'));

CREATE POLICY "Content managers can delete story lines"
  ON public.authentic_story_lines FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_reviewer'));

CREATE INDEX IF NOT EXISTS authentic_story_lines_story_idx
  ON public.authentic_story_lines(story_id, line_index);


-- updated_at triggers (reuse the existing shared function)
DROP TRIGGER IF EXISTS update_authentic_stories_updated_at ON public.authentic_stories;
CREATE TRIGGER update_authentic_stories_updated_at
  BEFORE UPDATE ON public.authentic_stories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_authentic_story_lines_updated_at ON public.authentic_story_lines;
CREATE TRIGGER update_authentic_story_lines_updated_at
  BEFORE UPDATE ON public.authentic_story_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
