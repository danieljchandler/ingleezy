-- Learner referrals (audit item D4). Distinct from invite_codes, which is
-- admin-issued beta gating: every learner owns exactly one shareable code, and
-- a redemption ties a new account to its referrer.
--
-- Rewards ride Stripe rather than local grants — subscribers is a cache that
-- check-subscription overwrites from Stripe on every check, so a hand-written
-- "free month" there would be clobbered within a minute. Instead: the referred
-- learner's first checkout auto-applies an env-configured coupon
-- (STRIPE_REFERRAL_COUPON in create-checkout), and the referrer gets a Stripe
-- customer-balance credit when their referral actually converts to a paid
-- plan (the pending → converted → rewarded ladder below, driven from
-- check-subscription). Gating the referrer reward on conversion is the
-- anti-abuse core: fabricated signups earn nothing.

CREATE TABLE public.referral_codes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

-- Owners see their own code; creation goes through the referral edge function
-- under the service role so codes come from one generator.
CREATE POLICY "Users read own referral code"
  ON public.referral_codes FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.referral_codes TO authenticated;
GRANT ALL ON public.referral_codes TO service_role;

CREATE TABLE public.referral_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- One redemption per new account, ever — the unique constraint is the
  -- anti-abuse backstop, not the edge function's checks.
  referred_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'rewarded')),
  converted_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_id <> referred_user_id)
);

CREATE INDEX idx_referral_redemptions_referrer
  ON public.referral_redemptions (referrer_id, created_at DESC);

ALTER TABLE public.referral_redemptions ENABLE ROW LEVEL SECURITY;

-- Both sides may see the rows they appear in (the referrer's count, the
-- referred learner's own pending discount); all writes are service-role.
CREATE POLICY "Participants read own redemptions"
  ON public.referral_redemptions FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR referred_user_id = auth.uid());

GRANT SELECT ON public.referral_redemptions TO authenticated;
GRANT ALL ON public.referral_redemptions TO service_role;
