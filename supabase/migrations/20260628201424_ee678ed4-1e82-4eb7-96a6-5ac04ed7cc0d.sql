
CREATE TABLE IF NOT EXISTS public.beta_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('bug','idea','confusing','praise','other')),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  route text,
  screenshot_url text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','in_progress','resolved','wont_fix')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beta_feedback_created_idx ON public.beta_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS beta_feedback_status_idx ON public.beta_feedback (status);
CREATE INDEX IF NOT EXISTS beta_feedback_user_idx ON public.beta_feedback (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.beta_feedback TO authenticated;
GRANT ALL ON public.beta_feedback TO service_role;

ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own feedback"
  ON public.beta_feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own feedback"
  ON public.beta_feedback FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update feedback"
  ON public.beta_feedback FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete feedback"
  ON public.beta_feedback FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER beta_feedback_updated_at
  BEFORE UPDATE ON public.beta_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.is_beta_tester()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'beta_tester') OR public.has_role(auth.uid(), 'admin')
$$;

CREATE OR REPLACE FUNCTION public.redeem_invite_code(_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id UUID := auth.uid();
  _row public.invite_codes%ROWTYPE;
  _normalized TEXT;
  _granted_beta BOOLEAN := false;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  _normalized := upper(trim(_code));

  IF _normalized IS NULL OR length(_normalized) = 0 THEN
    RAISE EXCEPTION 'Invite code required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.invite_redemptions WHERE user_id = _user_id) THEN
    RETURN jsonb_build_object('ok', true, 'already_redeemed', true);
  END IF;

  SELECT * INTO _row
    FROM public.invite_codes
    WHERE upper(code) = _normalized
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite code' USING ERRCODE = 'P0002';
  END IF;

  IF _row.expires_at IS NOT NULL AND _row.expires_at < now() THEN
    RAISE EXCEPTION 'Invite code expired' USING ERRCODE = 'P0003';
  END IF;

  IF _row.uses >= _row.max_uses THEN
    RAISE EXCEPTION 'Invite code already fully used' USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.invite_codes
    SET uses = uses + 1,
        updated_at = now()
    WHERE id = _row.id;

  INSERT INTO public.invite_redemptions (invite_code_id, user_id)
  VALUES (_row.id, _user_id);

  UPDATE public.profiles
    SET invited_via = _row.code
    WHERE user_id = _user_id;

  IF upper(_row.code) LIKE 'BETA%' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'beta_tester'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
    _granted_beta := true;
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', _row.code, 'beta_tester', _granted_beta);
END;
$function$;
