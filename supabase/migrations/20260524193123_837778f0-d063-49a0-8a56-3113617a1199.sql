
CREATE TABLE public.user_letter_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  letter_code text NOT NULL,
  steps_completed jsonb NOT NULL DEFAULT '[]'::jsonb,
  best_spot_score int NOT NULL DEFAULT 0,
  best_sound_score int NOT NULL DEFAULT 0,
  mastered_at timestamptz,
  last_practiced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, letter_code)
);

ALTER TABLE public.user_letter_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own letter progress" ON public.user_letter_progress
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own letter progress" ON public.user_letter_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own letter progress" ON public.user_letter_progress
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own letter progress" ON public.user_letter_progress
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_user_letter_progress_updated_at
  BEFORE UPDATE ON public.user_letter_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_user_letter_progress_user ON public.user_letter_progress(user_id);

CREATE TABLE public.user_checkpoint_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  checkpoint_index int NOT NULL,
  score int NOT NULL DEFAULT 0,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, checkpoint_index)
);

ALTER TABLE public.user_checkpoint_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own checkpoint progress" ON public.user_checkpoint_progress
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own checkpoint progress" ON public.user_checkpoint_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own checkpoint progress" ON public.user_checkpoint_progress
  FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX idx_user_checkpoint_progress_user ON public.user_checkpoint_progress(user_id);
