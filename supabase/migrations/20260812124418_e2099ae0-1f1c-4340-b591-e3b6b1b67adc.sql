CREATE TABLE IF NOT EXISTS public.llm_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  llm_used TEXT NOT NULL,
  phrase TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.llm_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin read llm_usage_logs" ON public.llm_usage_logs;
CREATE POLICY "Admin read llm_usage_logs"
  ON public.llm_usage_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Service role insert llm_usage_logs" ON public.llm_usage_logs;
CREATE POLICY "Service role insert llm_usage_logs"
  ON public.llm_usage_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

GRANT SELECT ON public.llm_usage_logs TO authenticated;
GRANT ALL ON public.llm_usage_logs TO service_role;

ALTER TABLE public.llm_usage_logs
  ADD COLUMN IF NOT EXISTS prompt_tokens integer,
  ADD COLUMN IF NOT EXISTS completion_tokens integer,
  ADD COLUMN IF NOT EXISTS cached_tokens integer,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12, 6),
  ADD COLUMN IF NOT EXISTS units numeric,
  ADD COLUMN IF NOT EXISTS unit_kind text;

CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_fn_created
  ON public.llm_usage_logs (function_name, created_at DESC);

CREATE TABLE IF NOT EXISTS public.voice_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('practice', 'assistant')),
  seconds integer NOT NULL CHECK (seconds > 0 AND seconds <= 7200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_usage_user_created ON public.voice_usage (user_id, created_at DESC);

ALTER TABLE public.voice_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own voice usage" ON public.voice_usage;
CREATE POLICY "Users read own voice usage"
  ON public.voice_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.voice_usage TO authenticated;
GRANT ALL ON public.voice_usage TO service_role;

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

ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS subscription_tier text;
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS subscription_end timestamptz;
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own subscriber row" ON public.subscribers;
CREATE POLICY "Users read own subscriber row"
  ON public.subscribers FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.subscribers TO authenticated;
GRANT ALL ON public.subscribers TO service_role;