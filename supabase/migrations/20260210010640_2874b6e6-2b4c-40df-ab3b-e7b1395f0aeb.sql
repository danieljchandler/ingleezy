
-- Create storage bucket for meme uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('meme-uploads', 'meme-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to meme-uploads
CREATE POLICY "Authenticated users can upload memes"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'meme-uploads' AND auth.uid() IS NOT NULL);

-- Allow public read access to meme uploads
CREATE POLICY "Public read access to meme uploads"
ON storage.objects FOR SELECT
USING (bucket_id = 'meme-uploads');

-- Allow users to delete their own uploads
CREATE POLICY "Users can delete own meme uploads"
ON storage.objects FOR DELETE
USING (bucket_id = 'meme-uploads' AND auth.uid() IS NOT NULL);
