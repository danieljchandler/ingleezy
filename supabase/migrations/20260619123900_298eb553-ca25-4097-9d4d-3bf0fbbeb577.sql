
-- ============================================================
-- Release-readiness security hardening
-- ============================================================

-- 1. Lock down SECURITY DEFINER function exposure.
--    has_role / is_admin / is_recorder are still usable inside RLS
--    policies even without anon EXECUTE; revoking PUBLIC closes a
--    pointless attack surface.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_recorder() FROM PUBLIC, anon;

-- Trigger-only function — nothing should call this directly.
REVOKE EXECUTE ON FUNCTION public._alert_from_metric() FROM PUBLIC, anon, authenticated;

-- Listen play counter is invoked by signed-in users only.
REVOKE EXECUTE ON FUNCTION public.increment_listen_play_count(uuid) FROM PUBLIC, anon;

-- 2. feature_metrics: instrumentation was silently failing because
--    no INSERT policy existed. Allow signed-in users + service role
--    to record metrics; admin-only read stays as-is.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.feature_metrics'::regclass
      AND polname = 'Authenticated can insert metrics'
  ) THEN
    CREATE POLICY "Authenticated can insert metrics"
      ON public.feature_metrics
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.feature_metrics'::regclass
      AND polname = 'Service role can insert metrics'
  ) THEN
    CREATE POLICY "Service role can insert metrics"
      ON public.feature_metrics
      FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END $$;

-- 3. usage_counters: client-side rate-limit tracking needs INSERT +
--    UPDATE for the row owner. increment_usage_counter() still works
--    as the canonical path, but this lets future code use the table
--    directly without breaking silently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.usage_counters'::regclass
      AND polname = 'Users can insert their own usage rows'
  ) THEN
    CREATE POLICY "Users can insert their own usage rows"
      ON public.usage_counters
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.usage_counters'::regclass
      AND polname = 'Users can update their own usage rows'
  ) THEN
    CREATE POLICY "Users can update their own usage rows"
      ON public.usage_counters
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
