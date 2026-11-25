-- Add 'bible_reader' to the app_role enum so admins can grant Bible reading access
-- The 'bible_reader' enum value is added by 20260412235959_app_role_bible_reader_value.sql, which must commit first.

-- Helper function: is the current user a bible_reader?
CREATE OR REPLACE FUNCTION public.is_bible_reader()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'bible_reader')
$$;
