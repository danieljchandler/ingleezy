-- llm_usage_logs recorded WHICH model answered but not what it cost: no token
-- counts, no provider, no dollars. That made "which feature loses money?"
-- unanswerable across eleven external providers. These columns are filled by
-- _shared/llmUsageLogger.ts from the usage block providers already return —
-- nothing new is fetched.
ALTER TABLE public.llm_usage_logs
  ADD COLUMN IF NOT EXISTS prompt_tokens integer,
  ADD COLUMN IF NOT EXISTS completion_tokens integer,
  ADD COLUMN IF NOT EXISTS cached_tokens integer,
  ADD COLUMN IF NOT EXISTS provider text,
  -- Provider-reported (OpenRouter returns spend per call); null when the
  -- gateway doesn't say. Deliberately not computed from a price table here —
  -- price tables drift, provider-reported numbers don't.
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12, 6),
  -- Non-LLM legs (TTS characters, ASR seconds, images) log through the same
  -- table so one query answers cost-per-feature; unit_kind says what `units`
  -- counts ('characters', 'seconds', 'images').
  ADD COLUMN IF NOT EXISTS units numeric,
  ADD COLUMN IF NOT EXISTS unit_kind text;

-- The admin cost view groups by function and week.
CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_fn_created
  ON public.llm_usage_logs (function_name, created_at DESC);
