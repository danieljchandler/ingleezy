-- Add image position field to vocabulary_words table
-- Stores x,y percentages for object-position CSS (e.g., "50 50" for center)
ALTER TABLE public.vocabulary_words 
ADD COLUMN image_position TEXT DEFAULT '50 50';