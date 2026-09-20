-- Two writers for two tables that had readers and no writer.
--
-- `review_streaks` has been read by six surfaces since the fork — the header
-- streak pill on every screen, the Majlis welcome, gamification, social,
-- analytics and notifications — and written by nothing at all. Not by the
-- client, not by an edge function, not by a trigger. Only the four owner
-- policies in 20260529155315 exist, granting insert and update on rows nobody
-- ever inserted. Every learner's streak therefore reads zero forever, and
-- `grant_achievement`'s `streak_days` branch can never be satisfied.
--
-- `weekly_goals` is the same shape of hole from the other direction.
-- 20260529150401 section 5 dropped the client's INSERT and UPDATE policies
-- ("remove client writes, add increment_review_count()"), but Onboarding and
-- Settings still upsert the table directly. Those upserts have been failing
-- against RLS ever since, unchecked in both call sites, so choosing a weekly
-- goal has been a no-op behind a "settings saved" toast. And
-- `increment_review_count` only ever counts completions — it never sets the
-- targets, so nothing replaced what the policy drop removed.
--
-- Both are fixed here the way `increment_review_count` was: a security-definer
-- function, revoked from PUBLIC and granted to `authenticated`, so the write
-- stays server-side and the client cannot set another learner's row.

-- ─── record_review_day ───────────────────────────────────────────────────────
-- Rolls the caller's streak for one calendar day.
--
-- The date is the CALLER'S LOCAL date, passed in rather than taken from
-- `current_date`. src/lib/localDate.ts is explicit that this app treats "today"
-- and streak boundaries in the learner's local timezone; a server-side
-- `current_date` is UTC and would break the day for every learner in a negative
-- offset, ending their streak an evening early.
--
-- Trusting a client-supplied date does need a bound, or a learner could post an
-- arbitrary sequence of consecutive dates and mint a streak. Real offsets run
-- from UTC-12 to UTC+14, so a genuine local date is never more than one day
-- either side of the server's; anything further is clamped rather than
-- rejected, because a wrong clock should cost a learner nothing worse than
-- having their day counted as the server's.
--
-- Idempotent within a day: the second review of the same day is a no-op, which
-- is what lets every review call it without the streak counting reviews.
CREATE OR REPLACE FUNCTION public.record_review_day(_local_date date DEFAULT NULL)
RETURNS public.review_streaks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _server_date date := (now() AT TIME ZONE 'utc')::date;
  _day date;
  _next integer;
  _row public.review_streaks;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  _day := COALESCE(_local_date, _server_date);
  IF _day < _server_date - 1 THEN _day := _server_date - 1; END IF;
  IF _day > _server_date + 1 THEN _day := _server_date + 1; END IF;

  -- Read the current row under a lock, so two reviews rated in the same second
  -- cannot both compute their next value from the same stale streak. On a first
  -- ever review nothing is found and `_row` stays NULL-filled, which the CASE
  -- below handles as the same thing as a gap: a new streak of one.
  SELECT * INTO _row
  FROM public.review_streaks
  WHERE user_id = _user_id
  FOR UPDATE;

  _next := CASE
    -- Already counted today. Leave the streak exactly as it is — this is what
    -- lets every review call this without the streak counting reviews.
    WHEN _row.last_review_date = _day THEN _row.current_streak
    -- Consecutive day: extend.
    WHEN _row.last_review_date = _day - 1 THEN _row.current_streak + 1
    -- A gap, a first review, or a day earlier than the one on record (a learner
    -- who crossed a timezone westward): start again at one rather than silently
    -- extending a stale streak.
    ELSE 1
  END;

  INSERT INTO public.review_streaks (user_id, current_streak, longest_streak, last_review_date)
  VALUES (_user_id, _next, _next, _day)
  ON CONFLICT (user_id) DO UPDATE
    SET current_streak = _next,
        longest_streak = GREATEST(public.review_streaks.longest_streak, _next),
        -- Never move the recorded day backwards: the streak is anchored to the
        -- latest day seen, so a late-arriving earlier date cannot rewind it.
        last_review_date = GREATEST(public.review_streaks.last_review_date, _day),
        updated_at = now()
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_review_day(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_review_day(date) TO authenticated;

-- ─── set_weekly_goal ─────────────────────────────────────────────────────────
-- Sets the caller's targets for the current week without touching what they
-- have already completed.
--
-- The week start is computed HERE and nowhere else. Three definitions were in
-- play before this: `increment_review_count` used `date_trunc('week')`, which
-- is Monday; `useWeeklyGoal` builds a Monday too, in local time; and Onboarding
-- and Settings both did `getDate() - getDay()`, which is SUNDAY. So even with
-- the policy restored, the targets a learner chose would have been written to a
-- row one day off the row the card reads — a goal that saves, and then does not
-- appear. One definition, server-side, ends that class of bug.
CREATE OR REPLACE FUNCTION public.set_weekly_goal(
  _target_reviews integer,
  _target_xp integer
)
RETURNS public.weekly_goals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _week_start date;
  _row public.weekly_goals;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF _target_reviews < 0 OR _target_xp < 0 THEN
    RAISE EXCEPTION 'Targets cannot be negative';
  END IF;

  _week_start := (date_trunc('week', (now() AT TIME ZONE 'utc')))::date;

  INSERT INTO public.weekly_goals (user_id, week_start_date, target_reviews, target_xp)
  VALUES (_user_id, _week_start, _target_reviews, _target_xp)
  ON CONFLICT (user_id, week_start_date) DO UPDATE
    SET target_reviews = EXCLUDED.target_reviews,
        target_xp = EXCLUDED.target_xp
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_weekly_goal(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_weekly_goal(integer, integer) TO authenticated;
