
CREATE TABLE public.user_phrases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phrase_arabic text NOT NULL,
  phrase_english text NOT NULL,
  transliteration text,
  notes text,
  source text NOT NULL DEFAULT 'how-do-i-say',
  ease_factor numeric NOT NULL DEFAULT 2.5,
  interval_days integer NOT NULL DEFAULT 0,
  repetitions integer NOT NULL DEFAULT 0,
  next_review_at timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, phrase_arabic)
);

ALTER TABLE public.user_phrases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own phrases" ON public.user_phrases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own phrases" ON public.user_phrases FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own phrases" ON public.user_phrases FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own phrases" ON public.user_phrases FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_user_phrases_user ON public.user_phrases(user_id);
