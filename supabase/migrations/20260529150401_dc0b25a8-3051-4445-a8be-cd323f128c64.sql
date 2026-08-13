
-- ============================================================
-- 1. profiles: own/admin only + leaderboard view
-- ============================================================
DROP POLICY IF EXISTS "Users can view all public profiles" ON public.profiles;

CREATE POLICY "Users view own profile or admin"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

CREATE OR REPLACE VIEW public.leaderboard_profiles
  WITH (security_invoker = false) AS
  SELECT user_id, display_name, avatar_url, institution_id, custom_institution, show_institution
  FROM public.profiles
  WHERE show_on_leaderboard = true;

GRANT SELECT ON public.leaderboard_profiles TO authenticated, anon;

-- ============================================================
-- 2. user_xp: remove client writes, add award_xp()
-- ============================================================
DROP POLICY IF EXISTS "Users can insert their own XP" ON public.user_xp;
DROP POLICY IF EXISTS "Users can update their own XP" ON public.user_xp;

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
  _week_start date;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  _amt := GREATEST(0, LEAST(_amount, 500));
  IF _amt = 0 THEN
    RETURN jsonb_build_object('awarded', 0);
  END IF;

  INSERT INTO public.user_xp (user_id, total_xp, xp_this_week, level)
  VALUES (_user_id, _amt, _amt, (_amt / 500) + 1)
  ON CONFLICT (user_id)
  DO UPDATE SET
    total_xp = public.user_xp.total_xp + _amt,
    xp_this_week = public.user_xp.xp_this_week + _amt,
    level = ((public.user_xp.total_xp + _amt) / 500) + 1,
    updated_at = now()
  RETURNING total_xp, level INTO _new_total, _new_level;

  _week_start := (date_trunc('week', (now() AT TIME ZONE 'utc')))::date;
  INSERT INTO public.weekly_goals (user_id, week_start_date, earned_xp)
  VALUES (_user_id, _week_start, _amt)
  ON CONFLICT (user_id, week_start_date)
  DO UPDATE SET earned_xp = public.weekly_goals.earned_xp + _amt;

  RETURN jsonb_build_object('total_xp', _new_total, 'level', _new_level, 'awarded', _amt);
END;
$$;

REVOKE ALL ON FUNCTION public.award_xp(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_xp(integer, text) TO authenticated;

-- ============================================================
-- 3. user_achievements: remove client INSERT, add grant_achievement()
-- ============================================================
DROP POLICY IF EXISTS "Users can insert their own achievements" ON public.user_achievements;

CREATE OR REPLACE FUNCTION public.grant_achievement(_achievement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _ach record;
  _met boolean := false;
  _count bigint;
  _streak integer;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, requirement_type, requirement_value, xp_reward
    INTO _ach FROM public.achievements WHERE id = _achievement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Achievement not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_achievements
    WHERE user_id = _user_id AND achievement_id = _achievement_id
  ) THEN
    RETURN jsonb_build_object('already_earned', true);
  END IF;

  CASE _ach.requirement_type
    WHEN 'reviews_completed' THEN
      SELECT count(*) INTO _count FROM public.word_reviews WHERE user_id = _user_id;
      _met := _count >= COALESCE(_ach.requirement_value, 0);
    WHEN 'words_learned' THEN
      SELECT count(*) INTO _count FROM public.word_reviews
        WHERE user_id = _user_id AND repetitions >= 1;
      _met := _count >= COALESCE(_ach.requirement_value, 0);
    WHEN 'streak_days' THEN
      SELECT COALESCE(current_streak, 0) INTO _streak
        FROM public.review_streaks WHERE user_id = _user_id;
      _met := COALESCE(_streak, 0) >= COALESCE(_ach.requirement_value, 0);
    ELSE
      _met := false;
  END CASE;

  IF NOT _met THEN
    RAISE EXCEPTION 'Achievement requirement not met';
  END IF;

  INSERT INTO public.user_achievements (user_id, achievement_id)
  VALUES (_user_id, _achievement_id)
  ON CONFLICT (user_id, achievement_id) DO NOTHING;

  PERFORM public.award_xp(_ach.xp_reward, 'achievement');

  RETURN jsonb_build_object('granted', true, 'xp_reward', _ach.xp_reward);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_achievement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_achievement(uuid) TO authenticated;

-- ============================================================
-- 4. user_checkpoint_progress: remove client writes, add record_checkpoint()
-- ============================================================
DROP POLICY IF EXISTS "Users insert own checkpoint progress" ON public.user_checkpoint_progress;
DROP POLICY IF EXISTS "Users update own checkpoint progress" ON public.user_checkpoint_progress;

CREATE OR REPLACE FUNCTION public.record_checkpoint(_index integer, _score integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _s integer;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _s := GREATEST(0, LEAST(_score, 100));
  INSERT INTO public.user_checkpoint_progress (user_id, checkpoint_index, score, completed_at)
  VALUES (_user_id, _index, _s, now())
  ON CONFLICT (user_id, checkpoint_index)
  DO UPDATE SET
    score = GREATEST(public.user_checkpoint_progress.score, _s),
    completed_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_checkpoint(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_checkpoint(integer, integer) TO authenticated;

-- ============================================================
-- 5. weekly_goals: remove client writes, add increment_review_count()
-- ============================================================
DROP POLICY IF EXISTS "Users can insert their own goals" ON public.weekly_goals;
DROP POLICY IF EXISTS "Users can update their own goals" ON public.weekly_goals;

CREATE OR REPLACE FUNCTION public.increment_review_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _week_start date;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _week_start := (date_trunc('week', (now() AT TIME ZONE 'utc')))::date;
  INSERT INTO public.weekly_goals (user_id, week_start_date, completed_reviews)
  VALUES (_user_id, _week_start, 1)
  ON CONFLICT (user_id, week_start_date)
  DO UPDATE SET completed_reviews = public.weekly_goals.completed_reviews + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_review_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_review_count() TO authenticated;

-- ============================================================
-- 6. client_errors: drop anon INSERT (authenticated still allowed)
-- ============================================================
DROP POLICY IF EXISTS "Anyone can log errors" ON public.client_errors;

CREATE POLICY "Authenticated users can log errors"
  ON public.client_errors FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- ============================================================
-- 7. content_import_logs: drop anon INSERT
-- ============================================================
DROP POLICY IF EXISTS "Anon users can insert logs" ON public.content_import_logs;

-- ============================================================
-- 8. processed_videos: restrict SELECT to authenticated
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view processed videos" ON public.processed_videos;

CREATE POLICY "Authenticated users can view processed videos"
  ON public.processed_videos FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 9. lessons: hide drafts from non-admins
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view lessons" ON public.lessons;

CREATE POLICY "Anyone can view published lessons"
  ON public.lessons FOR SELECT
  USING (status = 'published' OR public.is_admin());

-- ============================================================
-- 10. Revoke EXECUTE on role-check helpers from API roles
--     (still callable from within RLS policies via definer privilege)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_recorder() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated;
