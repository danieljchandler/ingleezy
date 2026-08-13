-- Drop loose write/delete policies that bypass owner check
DROP POLICY IF EXISTS "Authenticated users can upload memes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload tutor audio clips" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own meme uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own tutor audio clips" ON storage.objects;

-- Drop avatar policies superseded by lahja_owner_*
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;

-- Drop per-bucket public read superseded by lahja_public_read
DROP POLICY IF EXISTS "Anyone can read audio files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view flashcard audio" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view flashcard images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view tutor audio clips" ON storage.objects;
DROP POLICY IF EXISTS "Public read access to meme uploads" ON storage.objects;

-- Drop per-bucket admin write/delete superseded by lahja_admin_*
DROP POLICY IF EXISTS "Admins can upload audio files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update audio files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete audio files" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload flashcard audio" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update flashcard audio" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete flashcard audio" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload flashcard images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update flashcard images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete flashcard images" ON storage.objects;