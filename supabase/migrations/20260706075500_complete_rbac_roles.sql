ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'content_reviewer';

CREATE OR REPLACE FUNCTION public.is_content_reviewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'content_reviewer')
$$;

CREATE OR REPLACE FUNCTION public.can_manage_content()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_admin() OR public.is_content_reviewer()
$$;

CREATE OR REPLACE FUNCTION public.has_bible_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.is_admin()
    OR (
      public.has_role(auth.uid(), 'bible_reader')
      AND NOT public.has_role(auth.uid(), 'content_reviewer')
    )
$$;

CREATE OR REPLACE FUNCTION public.user_has_bible_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR (
      public.has_role(_user_id, 'bible_reader')
      AND NOT public.has_role(_user_id, 'content_reviewer')
    )
$$;

CREATE OR REPLACE FUNCTION public.admin_find_user(_identifier text)
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _normalized text := lower(trim(_identifier));
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can lookup users' USING ERRCODE = '42501';
  END IF;

  IF _normalized IS NULL OR length(_normalized) = 0 THEN
    RETURN;
  END IF;

  IF _normalized ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN QUERY
    SELECT u.id, u.email::text
    FROM auth.users u
    WHERE u.id = _normalized::uuid
    LIMIT 1;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE lower(u.email) = _normalized
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_managed_roles()
RETURNS TABLE(id uuid, user_id uuid, role app_role, created_at timestamptz, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can list managed roles' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ur.id, ur.user_id, ur.role, ur.created_at, u.email::text
  FROM public.user_roles ur
  LEFT JOIN auth.users u ON u.id = ur.user_id
  WHERE ur.role IN ('bible_reader', 'content_reviewer', 'beta_tester')
  ORDER BY ur.created_at DESC;
END;
$$;

DROP POLICY IF EXISTS "Admins can insert videos" ON public.discover_videos;
DROP POLICY IF EXISTS "Admins can update videos" ON public.discover_videos;
CREATE POLICY "Content managers can insert videos"
ON public.discover_videos
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_content());

CREATE POLICY "Content managers can update videos"
ON public.discover_videos
FOR UPDATE
TO authenticated
USING (public.can_manage_content())
WITH CHECK (public.can_manage_content());

DROP POLICY IF EXISTS "Anyone authenticated can read approved rules" ON public.dialect_rules;
DROP POLICY IF EXISTS "Admins can insert rules" ON public.dialect_rules;
DROP POLICY IF EXISTS "Admins can update rules" ON public.dialect_rules;

CREATE POLICY "Content managers can read rules"
  ON public.dialect_rules FOR SELECT TO authenticated
  USING (status = 'approved' OR public.can_manage_content());

CREATE POLICY "Content managers can insert rules"
  ON public.dialect_rules FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_content());

CREATE POLICY "Content managers can update rules"
  ON public.dialect_rules FOR UPDATE TO authenticated
  USING (public.can_manage_content())
  WITH CHECK (public.can_manage_content());

DROP POLICY IF EXISTS "Recorders can read native reviews" ON public.dialect_native_reviews;
DROP POLICY IF EXISTS "Recorders can update native reviews" ON public.dialect_native_reviews;

CREATE POLICY "Reviewers can read native reviews"
ON public.dialect_native_reviews
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'recorder'::app_role)
  OR public.has_role(auth.uid(), 'content_reviewer'::app_role)
);

CREATE POLICY "Reviewers can update native reviews"
ON public.dialect_native_reviews
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'recorder'::app_role)
  OR public.has_role(auth.uid(), 'content_reviewer'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'recorder'::app_role)
  OR public.has_role(auth.uid(), 'content_reviewer'::app_role)
);

DROP POLICY IF EXISTS "Bible readers can view published lessons" ON public.bible_lessons;
CREATE POLICY "Bible readers can view published lessons"
ON public.bible_lessons
FOR SELECT
USING ((published = true AND public.has_bible_access()) OR public.is_admin());

GRANT EXECUTE ON FUNCTION public.is_content_reviewer() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_content() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_bible_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_bible_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_find_user(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_managed_roles() TO authenticated, service_role;
