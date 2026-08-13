-- ── Telemetry insert lock-down ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can insert metrics" ON public.feature_metrics;

-- ── user_vocabulary transliteration ──────────────────────────────────────────
ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS transliteration text;

-- ── Starter set phrases (draft only) ─────────────────────────────────────────
INSERT INTO public.set_phrases
  (dialect, phrase_arabic, phrase_transliteration, phrase_english, reply_arabic, reply_transliteration, reply_english, formality, difficulty, status, tags)
VALUES
  ('Gulf', 'شلونك؟', 'shlonak?', 'How are you?', 'زين، الحمدلله', 'zain, al-hamdulillah', 'Good, thank God', 'casual', 'A1', 'draft', ARRAY['starter','greeting']),
  ('Gulf', 'تسلم', 'tislam', 'Thank you / bless you', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','gratitude']),
  ('Gulf', 'خلها علي', 'khalha 3alay', 'Let it be on me / I''ll take care of it', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','hospitality']),
  ('Gulf', 'إن شاء الله بخير', 'in sha'' allah bi khair', 'God willing, all is well', NULL, NULL, NULL, 'neutral', 'A1', 'draft', ARRAY['starter','well-wish']),
  ('Gulf', 'ما عليه', 'ma 3alaih', 'No worries / it''s fine', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','reassurance']),
  ('Gulf', 'الله يعطيك العافية', 'Allah y3teek al-3afya', 'God give you strength (said to someone working)', 'الله يعافيك', 'Allah y3afeek', 'God grant you wellness too', 'neutral', 'A2', 'draft', ARRAY['starter','well-wish']),
  ('Gulf', 'بشوي بشوي', 'bshway bshway', 'Slowly, slowly / take it easy', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','encouragement']),
  ('Gulf', 'الله يبارك فيك', 'Allah ybarik feek', 'God bless you', NULL, NULL, NULL, 'neutral', 'A2', 'draft', ARRAY['starter','gratitude']),
  ('Egyptian', 'إزيك؟', 'ezzayak?', 'How are you?', 'الحمد لله كويس', 'el-hamdu lillah kwayes', 'Good, thank God', 'casual', 'A1', 'draft', ARRAY['starter','greeting']),
  ('Egyptian', 'متشكر', 'mutshakkir', 'Thanks / I''m grateful', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','gratitude']),
  ('Egyptian', 'على راسي', '3ala rasi', 'On my head (of course / gladly)', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','hospitality']),
  ('Egyptian', 'ولا يهمك', 'wala yihimmak', 'Don''t worry about it / no problem', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','reassurance']),
  ('Egyptian', 'ربنا يخليك', 'rabbena yikhallik', 'God preserve you', NULL, NULL, NULL, 'neutral', 'A2', 'draft', ARRAY['starter','well-wish']),
  ('Egyptian', 'بالراحة عليك', 'bir-raha 3alek', 'Take it easy / slow down', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','encouragement']),
  ('Egyptian', 'الله يعطيك العافية', 'Allah y3teek el-3afya', 'God give you strength (said to someone working)', 'الله يعافيك', 'Allah y3afeek', 'God grant you wellness too', 'neutral', 'A2', 'draft', ARRAY['starter','well-wish']),
  ('Egyptian', 'تسلم إيدك', 'tislam idak', 'Bless your hands (compliment on food/work)', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','gratitude']),
  ('Yemeni', 'كيفك؟', 'kayfak?', 'How are you?', 'زين، الحمدلله', 'zayn, al-hamdulillah', 'Good, thank God', 'casual', 'A1', 'draft', ARRAY['starter','greeting']),
  ('Yemeni', 'يعطيك العافية', 'y3teek al-3afya', 'God give you strength (said to someone working)', 'الله يعافيك', 'Allah y3afeek', 'God grant you wellness too', 'neutral', 'A2', 'draft', ARRAY['starter','well-wish']),
  ('Yemeni', 'ما عليك من شي', 'ma 3alaik min shay', 'Don''t worry about a thing', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','reassurance']),
  ('Yemeni', 'على عيني وراسي', '3ala 3aini wa rasi', 'On my eye and head (of course / gladly)', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','hospitality']),
  ('Yemeni', 'الله يبارك فيك', 'Allah yubarik feek', 'God bless you', NULL, NULL, NULL, 'neutral', 'A2', 'draft', ARRAY['starter','gratitude']),
  ('Yemeni', 'بالتؤدة', 'bit-ta''ada', 'Slowly / take your time', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','encouragement']),
  ('Yemeni', 'تسلم يدك', 'tislam yadak', 'Bless your hands (compliment on food/work)', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','gratitude']),
  ('Yemeni', 'إن شاء الله بخير', 'in sha'' allah bi khair', 'God willing, all is well', NULL, NULL, NULL, 'neutral', 'A1', 'draft', ARRAY['starter','well-wish']);

-- ── daily_new_card_counts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_new_card_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_daily_new_card_counts_user_day ON public.daily_new_card_counts (user_id, day);

GRANT SELECT ON public.daily_new_card_counts TO authenticated;
GRANT ALL ON public.daily_new_card_counts TO service_role;

ALTER TABLE public.daily_new_card_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own new-card counts" ON public.daily_new_card_counts;
CREATE POLICY "Users can view their own new-card counts"
  ON public.daily_new_card_counts
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.increment_new_card_count(_amount integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_count integer;
BEGIN
  INSERT INTO public.daily_new_card_counts (user_id, day, count)
  VALUES (auth.uid(), (now() AT TIME ZONE 'utc')::date, _amount)
  ON CONFLICT (user_id, day)
  DO UPDATE SET count = daily_new_card_counts.count + _amount,
                updated_at = now()
  RETURNING count INTO _new_count;
  RETURN _new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_new_card_count(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.increment_new_card_count(integer) TO authenticated;

-- ── Daily XP tracking ────────────────────────────────────────────────────────
ALTER TABLE public.user_xp
  ADD COLUMN IF NOT EXISTS xp_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS xp_today_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date;

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

-- ── Daily story transliteration ──────────────────────────────────────────────
ALTER TABLE public.daily_vocab_stories
  ADD COLUMN IF NOT EXISTS body_transliteration text;

-- ── learner_errors ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.learner_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dialect text NOT NULL DEFAULT 'Gulf',
  source text NOT NULL CHECK (source IN (
    'pronunciation', 'shadow', 'sentence_coach', 'set_phrase_voice', 'quiz'
  )),
  target_arabic text NOT NULL,
  produced_arabic text,
  error_kind text NOT NULL DEFAULT 'other',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  word_id uuid REFERENCES public.vocabulary_words(id) ON DELETE SET NULL,
  user_vocabulary_id uuid REFERENCES public.user_vocabulary(id) ON DELETE CASCADE,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learner_errors_user_recent
  ON public.learner_errors (user_id, dialect, created_at DESC)
  WHERE resolved_at IS NULL;

GRANT SELECT ON public.learner_errors TO authenticated;
GRANT UPDATE (resolved_at) ON public.learner_errors TO authenticated;
GRANT ALL ON public.learner_errors TO service_role;

ALTER TABLE public.learner_errors ENABLE ROW LEVEL SECURITY;

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

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}'::text[];

-- ── word_reviews: production track, lapses, mnemonic ─────────────────────────
ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS production_ease_factor numeric NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS production_difficulty numeric NOT NULL DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS production_interval_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_repetitions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_next_review_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS production_last_reviewed_at timestamptz NULL;

ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_leech boolean NOT NULL DEFAULT false;

ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS mnemonic text;

COMMENT ON COLUMN public.word_reviews.mnemonic IS
  'Learner-specific memory hook for a leech card, generated by generate-mnemonic.';

CREATE INDEX IF NOT EXISTS idx_word_reviews_production_due
  ON public.word_reviews (user_id, production_next_review_at)
  WHERE production_next_review_at IS NOT NULL;

-- ── push_subscriptions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  timezone text,
  user_agent text,
  disabled_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active
  ON public.push_subscriptions (user_id)
  WHERE disabled_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can view their own push subscriptions"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can create their own push subscriptions"
  ON public.push_subscriptions FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can update their own push subscriptions"
  ON public.push_subscriptions FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can delete their own push subscriptions"
  ON public.push_subscriptions FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ── lesson_progress ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  last_word_index integer NOT NULL DEFAULT 0,
  words_seen integer NOT NULL DEFAULT 0,
  words_total integer NOT NULL DEFAULT 0,
  best_score numeric,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON public.lesson_progress (user_id);

GRANT SELECT, INSERT, UPDATE ON public.lesson_progress TO authenticated;
GRANT ALL ON public.lesson_progress TO service_role;

ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own lesson progress" ON public.lesson_progress;
CREATE POLICY "Users can view their own lesson progress"
  ON public.lesson_progress FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create their own lesson progress" ON public.lesson_progress;
CREATE POLICY "Users can create their own lesson progress"
  ON public.lesson_progress FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own lesson progress" ON public.lesson_progress;
CREATE POLICY "Users can update their own lesson progress"
  ON public.lesson_progress FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── user_concept_mastery hardening ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_concept_mastery'::regclass
      AND conname = 'user_concept_mastery_user_id_fkey'
  ) THEN
    ALTER TABLE public.user_concept_mastery
      ADD CONSTRAINT user_concept_mastery_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DROP POLICY IF EXISTS "Users read own mastery" ON public.user_concept_mastery;
CREATE POLICY "Users read own mastery"
  ON public.user_concept_mastery FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users insert own mastery" ON public.user_concept_mastery;
CREATE POLICY "Users insert own mastery"
  ON public.user_concept_mastery FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users update own mastery" ON public.user_concept_mastery;
CREATE POLICY "Users update own mastery"
  ON public.user_concept_mastery FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins read all mastery" ON public.user_concept_mastery;
CREATE POLICY "Admins read all mastery"
  ON public.user_concept_mastery FOR SELECT TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.user_concept_mastery TO authenticated;
GRANT SELECT ON public.curriculum_concepts TO authenticated;