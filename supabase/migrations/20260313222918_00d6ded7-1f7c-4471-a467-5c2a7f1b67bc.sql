
-- Create audio_files table
CREATE TABLE public.audio_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id TEXT NOT NULL,
  source_url TEXT,
  title TEXT,
  duration INTEGER,
  thumbnail TEXT,
  channel TEXT,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.audio_files ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins can manage audio_files"
ON public.audio_files FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Anyone can read
CREATE POLICY "Anyone can view audio_files"
ON public.audio_files FOR SELECT
TO anon, authenticated
USING (true);

-- Create public audio storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('audio', 'audio', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read on audio bucket
CREATE POLICY "Anyone can read audio files"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'audio');

-- Allow service role (edge function) uploads - admins can also upload
CREATE POLICY "Admins can upload audio files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'audio' AND public.is_admin());

CREATE POLICY "Admins can update audio files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'audio' AND public.is_admin())
WITH CHECK (bucket_id = 'audio' AND public.is_admin());

CREATE POLICY "Admins can delete audio files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'audio' AND public.is_admin());
