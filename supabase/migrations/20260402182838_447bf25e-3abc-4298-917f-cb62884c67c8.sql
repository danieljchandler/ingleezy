ALTER TABLE public.profiles
ADD COLUMN placement_level text,
ADD COLUMN placement_taken_at timestamptz;