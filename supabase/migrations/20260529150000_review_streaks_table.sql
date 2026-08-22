-- review_streaks: read in six places (the home hero's flame, StreakDisplay,
-- the streak-at-risk notification, achievements' streak_days requirement,
-- friends' feed, analytics) and — until the streak writer landed beside this
-- file — written by nothing. The table itself existed only in production: a
-- platform-made table the migrations never carried, which is why the two
-- migrations that reference it (20260529150401 and 20260529155315) were the
-- last two that could not replay from scratch.
--
-- Shape taken from the generated types, which record production's columns.
-- IF NOT EXISTS throughout, so replaying against the real database is a no-op.
-- Back-dated deliberately to sort before its two readers; no real Supabase
-- project is linked yet, so migration history is still editable (the same
-- window the semantic column renames used).
CREATE TABLE IF NOT EXISTS public.review_streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_review_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per learner — every reader does .maybeSingle() on user_id, and the
-- streak upsert needs a conflict target. Nothing has ever written the table
-- (that is the bug), so the unique index cannot collide with existing rows.
CREATE UNIQUE INDEX IF NOT EXISTS review_streaks_user_id_key
  ON public.review_streaks (user_id);
