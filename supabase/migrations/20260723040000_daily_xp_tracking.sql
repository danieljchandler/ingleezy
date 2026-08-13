-- Add real daily XP tracking. Today.tsx's daily-goal ring previously faked
-- "today's XP" by clamping xp_this_week to the goal (there was no daily
-- field), which is wrong for every day but the first of the week and
-- over-reports progress the learner hasn't actually made today.
ALTER TABLE public.user_xp
  ADD COLUMN xp_today integer NOT NULL DEFAULT 0,
  ADD COLUMN xp_today_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date;

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

  _week_start := (date_trunc('week', (now() AT TIME ZONE 'utc')))::date;
  INSERT INTO public.weekly_goals (user_id, week_start_date, earned_xp)
  VALUES (_user_id, _week_start, _amt)
  ON CONFLICT (user_id, week_start_date)
  DO UPDATE SET earned_xp = public.weekly_goals.earned_xp + _amt;

  RETURN jsonb_build_object('total_xp', _new_total, 'level', _new_level, 'xp_today', _new_xp_today, 'awarded', _amt);
END;
$$;

REVOKE ALL ON FUNCTION public.award_xp(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_xp(integer, text) TO authenticated;
