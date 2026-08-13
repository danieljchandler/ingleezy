
-- Create discover_videos table
CREATE TABLE public.discover_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  title_arabic text,
  source_url text NOT NULL,
  platform text NOT NULL DEFAULT 'youtube',
  embed_url text NOT NULL,
  thumbnail_url text,
  duration_seconds integer,
  dialect text NOT NULL DEFAULT 'Gulf',
  difficulty text NOT NULL DEFAULT 'Beginner',
  transcript_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  vocabulary jsonb NOT NULL DEFAULT '[]'::jsonb,
  grammar_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  cultural_context text,
  published boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.discover_videos ENABLE ROW LEVEL SECURITY;

-- Anyone can view published videos
CREATE POLICY "Anyone can view published videos"
ON public.discover_videos
FOR SELECT
USING (published = true OR is_admin());

-- Admins can insert videos
CREATE POLICY "Admins can insert videos"
ON public.discover_videos
FOR INSERT
WITH CHECK (is_admin());

-- Admins can update videos
CREATE POLICY "Admins can update videos"
ON public.discover_videos
FOR UPDATE
USING (is_admin());

-- Admins can delete videos
CREATE POLICY "Admins can delete videos"
ON public.discover_videos
FOR DELETE
USING (is_admin());

-- Trigger for updated_at
CREATE TRIGGER update_discover_videos_updated_at
BEFORE UPDATE ON public.discover_videos
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
