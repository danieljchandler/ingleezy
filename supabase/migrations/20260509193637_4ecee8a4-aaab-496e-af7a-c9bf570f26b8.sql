
-- Occasions
CREATE TABLE public.set_phrase_occasions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  name_arabic text,
  description text,
  icon_name text NOT NULL DEFAULT 'MessageCircle',
  display_order integer NOT NULL DEFAULT 0,
  dialect text NOT NULL DEFAULT 'Gulf',
  difficulty_floor text NOT NULL DEFAULT 'A1',
  status text NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dialect, slug)
);

ALTER TABLE public.set_phrase_occasions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published occasions"
  ON public.set_phrase_occasions FOR SELECT
  USING (status = 'published' OR is_admin());

CREATE POLICY "Admins manage occasions"
  ON public.set_phrase_occasions FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE TRIGGER set_phrase_occasions_updated_at
  BEFORE UPDATE ON public.set_phrase_occasions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Phrases
CREATE TABLE public.set_phrases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occasion_id uuid REFERENCES public.set_phrase_occasions(id) ON DELETE SET NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  phrase_arabic text NOT NULL,
  phrase_transliteration text,
  phrase_english text,
  phrase_audio_url text,
  reply_arabic text,
  reply_transliteration text,
  reply_english text,
  reply_audio_url text,
  scenario_english text,
  cultural_note text,
  formality text NOT NULL DEFAULT 'neutral',
  difficulty text NOT NULL DEFAULT 'A1',
  accepted_variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  cached_distractors jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.set_phrases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published phrases"
  ON public.set_phrases FOR SELECT
  USING (status = 'published' OR is_admin());

CREATE POLICY "Admins manage phrases"
  ON public.set_phrases FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE TRIGGER set_phrases_updated_at
  BEFORE UPDATE ON public.set_phrases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_set_phrases_occasion ON public.set_phrases(occasion_id);
CREATE INDEX idx_set_phrases_dialect_status ON public.set_phrases(dialect, status);

-- User SRS state
CREATE TABLE public.user_set_phrases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phrase_id uuid NOT NULL REFERENCES public.set_phrases(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual_save',
  ease_factor numeric NOT NULL DEFAULT 2.5,
  interval_days integer NOT NULL DEFAULT 0,
  repetitions integer NOT NULL DEFAULT 0,
  next_review_at timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  last_quality integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, phrase_id)
);

ALTER TABLE public.user_set_phrases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own user_set_phrases"
  ON public.user_set_phrases FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own user_set_phrases"
  ON public.user_set_phrases FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own user_set_phrases"
  ON public.user_set_phrases FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Users delete own user_set_phrases"
  ON public.user_set_phrases FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER user_set_phrases_updated_at
  BEFORE UPDATE ON public.user_set_phrases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_user_set_phrases_due ON public.user_set_phrases(user_id, next_review_at);

-- Attempts
CREATE TABLE public.set_phrase_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phrase_id uuid NOT NULL REFERENCES public.set_phrases(id) ON DELETE CASCADE,
  question_type text NOT NULL,
  answer_mode text NOT NULL,
  correct boolean NOT NULL DEFAULT false,
  asr_transcript text,
  asr_similarity numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.set_phrase_quiz_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own attempts"
  ON public.set_phrase_quiz_attempts FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own attempts"
  ON public.set_phrase_quiz_attempts FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all attempts"
  ON public.set_phrase_quiz_attempts FOR SELECT TO authenticated
  USING (is_admin());

CREATE INDEX idx_attempts_user ON public.set_phrase_quiz_attempts(user_id, created_at DESC);
