-- Add 'bible_reader' to the app_role enum so admins can grant Bible reading access
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'bible_reader';

-- Helper function: is the current user a bible_reader?
CREATE OR REPLACE FUNCTION public.is_bible_reader()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'bible_reader')
$$;
