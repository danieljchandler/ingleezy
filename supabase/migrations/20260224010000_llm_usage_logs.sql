-- Create llm_usage_logs table for tracking which LLM was used per request
CREATE TABLE public.llm_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  llm_used TEXT NOT NULL,
  phrase TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.llm_usage_logs ENABLE ROW LEVEL SECURITY;

-- Admin can read all logs
CREATE POLICY "Admin read llm_usage_logs"
  ON public.llm_usage_logs
  FOR SELECT
  USING (public.is_admin());

-- Service role (used by edge functions via SUPABASE_SERVICE_ROLE_KEY) bypasses RLS entirely.
-- This policy is a no-op for the service role but ensures the schema intention is documented.
CREATE POLICY "Service role insert llm_usage_logs"
  ON public.llm_usage_logs
  FOR INSERT
  WITH CHECK (true);
