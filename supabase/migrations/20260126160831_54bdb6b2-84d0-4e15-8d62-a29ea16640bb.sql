-- Create a helper function to check if user is a recorder
CREATE OR REPLACE FUNCTION public.is_recorder()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'recorder')
$$;

-- Update vocabulary_words INSERT policy to allow recorders
DROP POLICY IF EXISTS "Admins can insert vocabulary words" ON public.vocabulary_words;
CREATE POLICY "Admins and recorders can insert vocabulary words"
ON public.vocabulary_words
FOR INSERT
WITH CHECK (is_admin() OR is_recorder());

-- Update vocabulary_words UPDATE policy to allow recorders
DROP POLICY IF EXISTS "Admins can update vocabulary words" ON public.vocabulary_words;
CREATE POLICY "Admins and recorders can update vocabulary words"
ON public.vocabulary_words
FOR UPDATE
USING (is_admin() OR is_recorder())
WITH CHECK (is_admin() OR is_recorder());

-- Allow recorders to view user_roles (so they can check their own role)
CREATE POLICY "Users can view their own role"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);