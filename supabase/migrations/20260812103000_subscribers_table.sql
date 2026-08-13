-- subscribers existed only in production — documented schema debt in
-- docs/testing.md: usageCap.ts reads it to decide who is a paying customer,
-- so on a rebuilt database every user looked free-tier. IF NOT EXISTS makes
-- this replay as a no-op against production while giving a fresh database the
-- real table. The shape matches what check-subscription writes and what
-- usageCap/getSubscriptionTier read (per-tier allowances need
-- subscription_tier).
CREATE TABLE IF NOT EXISTS public.subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  stripe_customer_id text,
  subscribed boolean NOT NULL DEFAULT false,
  subscription_tier text,
  subscription_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Production's copy predates this migration; make sure the columns the code
-- now depends on exist there too.
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS subscription_tier text;
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS subscription_end timestamptz;
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

-- Users may read their own row (the pricing page shows current plan);
-- all writes happen in edge functions under the service role.
DROP POLICY IF EXISTS "Users read own subscriber row" ON public.subscribers;
CREATE POLICY "Users read own subscriber row"
  ON public.subscribers FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.subscribers TO authenticated;
GRANT ALL ON public.subscribers TO service_role;
