
-- Create tutor_upload_candidates table
CREATE TABLE public.tutor_upload_candidates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  upload_id UUID NOT NULL,
  word_text TEXT NOT NULL,
  word_standard TEXT,
  word_english TEXT,
  sentence_text TEXT,
  sentence_english TEXT,
  word_start_ms INTEGER,
  word_end_ms INTEGER,
  sentence_start_ms INTEGER,
  sentence_end_ms INTEGER,
  confidence NUMERIC DEFAULT 0,
  classification TEXT DEFAULT 'CONCRETE',
  status TEXT NOT NULL DEFAULT 'pending',
  word_audio_url TEXT,
  sentence_audio_url TEXT,
  image_url TEXT,
  source_audio_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tutor_upload_candidates ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own candidates"
  ON public.tutor_upload_candidates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own candidates"
  ON public.tutor_upload_candidates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own candidates"
  ON public.tutor_upload_candidates FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own candidates"
  ON public.tutor_upload_candidates FOR DELETE
  USING (auth.uid() = user_id);

-- Add columns to user_vocabulary for audio clips and traceability
ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS word_audio_url TEXT,
  ADD COLUMN IF NOT EXISTS sentence_audio_url TEXT,
  ADD COLUMN IF NOT EXISTS source_upload_id UUID;

-- Create storage bucket for tutor audio clips
INSERT INTO storage.buckets (id, name, public)
VALUES ('tutor-audio-clips', 'tutor-audio-clips', true);

-- Storage RLS policies
CREATE POLICY "Anyone can view tutor audio clips"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tutor-audio-clips');

CREATE POLICY "Authenticated users can upload tutor audio clips"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tutor-audio-clips' AND auth.role() = 'authenticated');

CREATE POLICY "Users can delete their own tutor audio clips"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'tutor-audio-clips' AND auth.role() = 'authenticated');
