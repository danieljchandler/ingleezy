-- Create fanar_usage table for tracking daily Fanar API usage (rate limit budget)
CREATE TABLE public.fanar_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL,  -- 'stt', 'stt-lf', 'mt', 'chat'
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fanar_usage_daily ON fanar_usage (endpoint, created_at);

-- Enable RLS
ALTER TABLE public.fanar_usage ENABLE ROW LEVEL SECURITY;

-- Admin can read all usage records
CREATE POLICY "Admin read fanar_usage"
  ON public.fanar_usage
  FOR SELECT
  USING (public.is_admin());

-- Service role (used by edge functions via SUPABASE_SERVICE_ROLE_KEY) bypasses RLS entirely.
CREATE POLICY "Service role insert fanar_usage"
  ON public.fanar_usage
  FOR INSERT
  WITH CHECK (true);
