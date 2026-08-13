ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'complimentary';

CREATE OR REPLACE FUNCTION public.has_complimentary_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = 'complimentary'
  )
$$;

CREATE OR REPLACE FUNCTION public.admin_list_managed_roles()
 RETURNS TABLE(id uuid, user_id uuid, role app_role, created_at timestamp with time zone, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can list managed roles' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT ur.id, ur.user_id, ur.role, ur.created_at, u.email::text
    FROM public.user_roles ur LEFT JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.role::text IN ('bible_reader', 'content_reviewer', 'beta_tester', 'complimentary')
    ORDER BY ur.created_at DESC;
END; $function$;