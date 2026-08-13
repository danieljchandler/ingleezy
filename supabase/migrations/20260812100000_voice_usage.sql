-- Live voice had the app's only unmetered AI spend: practice mode capped
-- sessions per day but not their length, and assistant mode (subscribers-only)
-- had no limit at all — while OpenAI Realtime bills by the minute. voice_usage
-- records consumed seconds per call so realtime-session-token can enforce a
-- monthly minute budget per subscription tier before minting a client secret.
CREATE TABLE public.voice_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('practice', 'assistant')),
  -- One report per call; the edge function clamps to two hours so a forged
  -- payload can't exhaust a month in one write. Zero-length calls are dropped
  -- before insert rather than stored.
  seconds integer NOT NULL CHECK (seconds > 0 AND seconds <= 7200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The hot query is "this user's seconds this month".
CREATE INDEX idx_voice_usage_user_created ON public.voice_usage (user_id, created_at DESC);

ALTER TABLE public.voice_usage ENABLE ROW LEVEL SECURITY;

-- Learners may read their own consumption (the client shows a remaining
-- balance); every write goes through the edge function under the service role,
-- so nobody can inflate or shrink their own meter.
CREATE POLICY "Users read own voice usage"
  ON public.voice_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.voice_usage TO authenticated;
GRANT ALL ON public.voice_usage TO service_role;
