-- Tighten INSERT policies on telemetry tables.
--
-- fanar_usage, llm_usage_logs and feature_metrics are written only by edge
-- functions using the service-role key, which bypasses RLS. Their existing
-- INSERT policies used `WITH CHECK (true)` with no role restriction (or granted
-- to `authenticated`), which let any anon/authenticated client forge usage and
-- metric rows via the anon key that ships in the browser bundle. Reads stay
-- admin-only, so the impact was log pollution — but there is no legitimate
-- client-side insert to any of these tables, so we lock inserts down to
-- service_role only.

-- ── fanar_usage ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role insert fanar_usage" ON public.fanar_usage;
CREATE POLICY "Service role insert fanar_usage"
  ON public.fanar_usage
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── llm_usage_logs ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role insert llm_usage_logs" ON public.llm_usage_logs;
CREATE POLICY "Service role insert llm_usage_logs"
  ON public.llm_usage_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── feature_metrics ──────────────────────────────────────────────────────────
-- Remove the permissive authenticated-insert policy; the service_role policy
-- created in 20260619123900 remains and covers all edge-function writes.
DROP POLICY IF EXISTS "Authenticated can insert metrics" ON public.feature_metrics;
