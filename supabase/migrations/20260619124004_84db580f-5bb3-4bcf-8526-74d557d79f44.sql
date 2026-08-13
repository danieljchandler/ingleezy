
CREATE OR REPLACE FUNCTION public.verify_invite_code(_code TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invite_codes
    WHERE upper(code) = upper(trim(_code))
      AND uses < max_uses
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.verify_invite_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_invite_code(TEXT) TO anon, authenticated;
