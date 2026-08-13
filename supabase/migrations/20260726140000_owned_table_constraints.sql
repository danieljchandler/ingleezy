-- Ownership constraints and RLS hardening for the three tables added in #218.
--
-- These changes were originally made by editing 20260726100000_learner_errors,
-- 20260726120000_push_subscriptions and 20260726130000_lesson_progress in place.
-- That doesn't work: Supabase records applied migrations by their version
-- timestamp in supabase_migrations.schema_migrations and never re-runs a version
-- it has already seen, so on any database where those three had already been
-- applied the edits would have been silently ignored — the FK would be missing,
-- the over-broad UPDATE grant would stand, and the RLS policies would keep
-- re-evaluating auth.uid() per row.
--
-- So it goes in a forward migration instead. Everything here is written to be
-- safe in both directions: idempotent if the originals ran as first written, and
-- correct if they ran with the edits already applied.
--
-- Three things are being fixed:
--   1. user_id was a bare uuid with no reference to auth.users, so deleting an
--      account left these rows orphaned.
--   2. learner_errors granted UPDATE on every column, letting a user rewrite the
--      target_arabic and detail that feed their own content generation.
--   3. Policies called auth.uid() unwrapped, which Postgres re-evaluates once
--      per row rather than once per query (Supabase's auth_rls_initplan advisory).

-- ── 1. Cascade on account deletion ───────────────────────────────────────────
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the catalog check.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['learner_errors', 'push_subscriptions', 'lesson_progress']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = format('public.%I', t)::regclass
        AND conname = format('%s_user_id_fkey', t)
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I
           ADD CONSTRAINT %I FOREIGN KEY (user_id)
           REFERENCES auth.users(id) ON DELETE CASCADE',
        t, format('%s_user_id_fkey', t)
      );
    END IF;
  END LOOP;
END $$;

-- ── 2. Column-scoped UPDATE on learner_errors ────────────────────────────────
-- A learner may dismiss their own error; they may not rewrite what it says.

REVOKE UPDATE ON public.learner_errors FROM authenticated;
GRANT UPDATE (resolved_at) ON public.learner_errors TO authenticated;

-- ── 3. Wrap auth.uid() so RLS evaluates it once per query ────────────────────
-- DROP ... IF EXISTS then CREATE, so this is safe to re-run and correct whether
-- the original policies exist in wrapped or unwrapped form.

DROP POLICY IF EXISTS "Users can view their own errors" ON public.learner_errors;
CREATE POLICY "Users can view their own errors"
  ON public.learner_errors
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can resolve their own errors" ON public.learner_errors;
CREATE POLICY "Users can resolve their own errors"
  ON public.learner_errors
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can view their own push subscriptions"
  ON public.push_subscriptions
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can create their own push subscriptions"
  ON public.push_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can update their own push subscriptions"
  ON public.push_subscriptions
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can delete their own push subscriptions"
  ON public.push_subscriptions
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own lesson progress" ON public.lesson_progress;
CREATE POLICY "Users can view their own lesson progress"
  ON public.lesson_progress
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create their own lesson progress" ON public.lesson_progress;
CREATE POLICY "Users can create their own lesson progress"
  ON public.lesson_progress
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own lesson progress" ON public.lesson_progress;
CREATE POLICY "Users can update their own lesson progress"
  ON public.lesson_progress
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
