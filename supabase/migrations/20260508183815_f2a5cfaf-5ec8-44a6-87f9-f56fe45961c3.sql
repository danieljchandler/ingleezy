
CREATE TABLE public.meme_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  dialect text NOT NULL DEFAULT 'Gulf',
  media_url text NOT NULL,
  media_type text NOT NULL DEFAULT 'image',
  thumbnail_url text,
  source_url text,
  title text NOT NULL DEFAULT '',
  title_arabic text NOT NULL DEFAULT '',
  on_screen_text jsonb NOT NULL DEFAULT '[]'::jsonb,
  audio_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  vocabulary jsonb NOT NULL DEFAULT '[]'::jsonb,
  grammar_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  meme_explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  has_speech boolean NOT NULL DEFAULT false,
  has_music boolean NOT NULL DEFAULT false,
  audio_skipped_reason text,
  tags text[] NOT NULL DEFAULT '{}',
  difficulty text NOT NULL DEFAULT 'A1',
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz
);

ALTER TABLE public.meme_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage memes" ON public.meme_posts
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Anyone can view published memes" ON public.meme_posts
  FOR SELECT
  USING (status = 'published' OR is_admin());

CREATE TRIGGER meme_posts_updated_at
  BEFORE UPDATE ON public.meme_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_meme_posts_status ON public.meme_posts(status, published_at DESC);
CREATE INDEX idx_meme_posts_dialect ON public.meme_posts(dialect);
