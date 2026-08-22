-- Write the streak, and stop losing the weekly target every Monday.
--
-- Two long-standing gaps in one function:
--
-- 1. THE STREAK HAD NO WRITER. review_streaks was read by six surfaces and
--    written by none — increment_review_count touches only weekly_goals
--    despite its name — so the flame on the home hero, the streak-at-risk
--    notification and every streak_days achievement ran on a number nothing
--    produced. award_xp is the right writer: every activity that counts
--    toward a day already lands here, so "a day with XP" is the streak's
--    definition and reviews need no second path.
--
-- 2. THE WEEKLY TARGET DID NOT ROLL OVER. Onboarding and Settings write the
--    learner's chosen target onto the CURRENT week's row only; the next
--    week's row was created here with the migration default, so the chosen
--    goal quietly vanished every Monday (WeeklyGoalCard documents the
--    resulting zero-target state). The preset id survives on
--    profiles.weekly_goal, so a fresh week's row now seeds its targets from
--    it. Targets are seeded only on INSERT — a learner-edited target on an
--    existing row is never overwritten.
CREATE OR REPLACE FUNCTION public.award_xp(_amount integer, _reason text DEFAULT 'unknown')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _amt integer;
  _new_total integer;
  _new_level integer;
  _new_xp_today integer;
  _week_start date;
  _today date := (now() AT TIME ZONE 'utc')::date;
  _goal text;
  _target_xp integer;
  _target_reviews integer;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  _amt := GREATEST(0, LEAST(_amount, 500));
  IF _amt = 0 THEN
    RETURN jsonb_build_object('awarded', 0);
  END IF;

  INSERT INTO public.user_xp (user_id, total_xp, xp_this_week, level, xp_today, xp_today_date)
  VALUES (_user_id, _amt, _amt, (_amt / 500) + 1, _amt, _today)
  ON CONFLICT (user_id)
  DO UPDATE SET
    total_xp = public.user_xp.total_xp + _amt,
    xp_this_week = public.user_xp.xp_this_week + _amt,
    level = ((public.user_xp.total_xp + _amt) / 500) + 1,
    xp_today = CASE WHEN public.user_xp.xp_today_date = _today
                     THEN public.user_xp.xp_today + _amt
                     ELSE _amt END,
    xp_today_date = _today,
    updated_at = now()
  RETURNING total_xp, level, xp_today INTO _new_total, _new_level, _new_xp_today;

  -- The streak: same day is a no-op, yesterday extends, anything older
  -- restarts at one. Longest is compared against the freshly computed value,
  -- not the stored one, so a record day counts the day it happens.
  INSERT INTO public.review_streaks (user_id, current_streak, longest_streak, last_review_date)
  VALUES (_user_id, 1, 1, _today)
  ON CONFLICT (user_id)
  DO UPDATE SET
    current_streak = CASE
      WHEN public.review_streaks.last_review_date = _today THEN public.review_streaks.current_streak
      WHEN public.review_streaks.last_review_date = _today - 1 THEN public.review_streaks.current_streak + 1
      ELSE 1 END,
    longest_streak = GREATEST(
      public.review_streaks.longest_streak,
      CASE
        WHEN public.review_streaks.last_review_date = _today THEN public.review_streaks.current_streak
        WHEN public.review_streaks.last_review_date = _today - 1 THEN public.review_streaks.current_streak + 1
        ELSE 1 END),
    last_review_date = _today,
    updated_at = now();

  SELECT weekly_goal INTO _goal FROM public.profiles WHERE user_id = _user_id;
  _target_xp := CASE _goal
    WHEN 'casual' THEN 100
    WHEN 'serious' THEN 500
    WHEN 'intensive' THEN 750
    ELSE 300 END;
  _target_reviews := CASE _goal
    WHEN 'casual' THEN 20
    WHEN 'serious' THEN 100
    WHEN 'intensive' THEN 150
    ELSE 50 END;

  _week_start := (date_trunc('week', (now() AT TIME ZONE 'utc')))::date;
  INSERT INTO public.weekly_goals (user_id, week_start_date, earned_xp, target_xp, target_reviews)
  VALUES (_user_id, _week_start, _amt, _target_xp, _target_reviews)
  ON CONFLICT (user_id, week_start_date)
  DO UPDATE SET earned_xp = public.weekly_goals.earned_xp + _amt;

  RETURN jsonb_build_object('total_xp', _new_total, 'level', _new_level, 'xp_today', _new_xp_today, 'awarded', _amt);
END;
$$;

REVOKE ALL ON FUNCTION public.award_xp(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_xp(integer, text) TO authenticated;

-- Same rollover fix for the review counter's row creation.
CREATE OR REPLACE FUNCTION public.increment_review_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _week_start date;
  _goal text;
  _target_xp integer;
  _target_reviews integer;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT weekly_goal INTO _goal FROM public.profiles WHERE user_id = _user_id;
  _target_xp := CASE _goal
    WHEN 'casual' THEN 100
    WHEN 'serious' THEN 500
    WHEN 'intensive' THEN 750
    ELSE 300 END;
  _target_reviews := CASE _goal
    WHEN 'casual' THEN 20
    WHEN 'serious' THEN 100
    WHEN 'intensive' THEN 150
    ELSE 50 END;

  _week_start := (date_trunc('week', (now() AT TIME ZONE 'utc')))::date;
  INSERT INTO public.weekly_goals (user_id, week_start_date, completed_reviews, target_xp, target_reviews)
  VALUES (_user_id, _week_start, 1, _target_xp, _target_reviews)
  ON CONFLICT (user_id, week_start_date)
  DO UPDATE SET completed_reviews = public.weekly_goals.completed_reviews + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_review_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_review_count() TO authenticated;
