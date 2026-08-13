-- Drop redundant owner-based delete policies; lahja_owner_delete_user_buckets already covers these via foldername path
DROP POLICY IF EXISTS "Users can delete their own meme uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own tutor audio clips" ON storage.objects;