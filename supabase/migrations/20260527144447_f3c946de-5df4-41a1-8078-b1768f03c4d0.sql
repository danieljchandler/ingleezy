CREATE TABLE public.daily_vocab_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  story_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  dialect text NOT NULL DEFAULT 'Gulf',
  title text NOT NULL,
  body_arabic text NOT NULL,
  body_english text,
  vocab_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  new_words jsonb NOT NULL DEFAULT '[]'::jsonb,
  audio_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, story_date, dialect)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_vocab_stories TO authenticated;
GRANT ALL ON public.daily_vocab_stories TO service_role;

ALTER TABLE public.daily_vocab_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own daily stories"
  ON public.daily_vocab_stories FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own daily stories"
  ON public.daily_vocab_stories FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own daily stories"
  ON public.daily_vocab_stories FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_daily_vocab_stories_user_date
  ON public.daily_vocab_stories (user_id, story_date DESC);
