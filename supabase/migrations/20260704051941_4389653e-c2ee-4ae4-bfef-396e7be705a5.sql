-- Fix vocabulary_words RLS: policies were created for the public role, causing
-- "permission denied for function is_admin" when anon requests are evaluated.
DROP POLICY IF EXISTS "Admins and recorders can insert vocabulary words" ON public.vocabulary_words;
DROP POLICY IF EXISTS "Admins and recorders can update vocabulary words" ON public.vocabulary_words;

CREATE POLICY "Admins and recorders can insert vocabulary words"
ON public.vocabulary_words
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin() OR public.is_recorder());

CREATE POLICY "Admins and recorders can update vocabulary words"
ON public.vocabulary_words
FOR UPDATE
TO authenticated
USING (public.is_admin() OR public.is_recorder())
WITH CHECK (public.is_admin() OR public.is_recorder());

-- Ensure the SECURITY DEFINER helpers are executable by the roles that need them.
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_recorder() TO authenticated;