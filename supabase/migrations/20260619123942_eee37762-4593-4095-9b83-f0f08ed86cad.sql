
-- ============================================================
-- Closed-beta invite-code gate
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  note TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invite_codes TO authenticated;
GRANT ALL ON public.invite_codes TO service_role;
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all invite codes"
  ON public.invite_codes FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can create invite codes"
  ON public.invite_codes FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND auth.uid() = created_by);

CREATE POLICY "Admins can update invite codes"
  ON public.invite_codes FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete invite codes"
  ON public.invite_codes FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE TRIGGER trg_invite_codes_updated_at
  BEFORE UPDATE ON public.invite_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS invite_codes_code_idx ON public.invite_codes (code);

-- Redemption history
CREATE TABLE IF NOT EXISTS public.invite_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code_id UUID NOT NULL REFERENCES public.invite_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT ON public.invite_redemptions TO authenticated;
GRANT ALL ON public.invite_redemptions TO service_role;
ALTER TABLE public.invite_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all redemptions"
  ON public.invite_redemptions FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Users can view their own redemption"
  ON public.invite_redemptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Track invite source on profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invited_via TEXT;

-- Atomic redemption function — validates, increments, records, marks profile.
CREATE OR REPLACE FUNCTION public.redeem_invite_code(_code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _row public.invite_codes%ROWTYPE;
  _normalized TEXT;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  _normalized := upper(trim(_code));

  IF _normalized IS NULL OR length(_normalized) = 0 THEN
    RAISE EXCEPTION 'Invite code required' USING ERRCODE = '22023';
  END IF;

  -- Already redeemed? Idempotent success.
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

  RETURN jsonb_build_object('ok', true, 'code', _row.code);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(TEXT) TO authenticated;

-- Helper: has the current user redeemed an invite?
CREATE OR REPLACE FUNCTION public.has_redeemed_invite()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invite_redemptions WHERE user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_redeemed_invite() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_redeemed_invite() TO authenticated;
