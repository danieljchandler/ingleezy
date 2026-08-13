-- =====================================================
-- LISTEN: AI-generated dialect audio content library
-- =====================================================

-- 1. Episodes (shared library)
CREATE TABLE public.listen_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL,
  dialect TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('podcast','ted','interview','story')),
  topic TEXT NOT NULL,
  topic_category TEXT,
  length_bucket TEXT NOT NULL CHECK (length_bucket IN ('short','medium','long')),
  title TEXT NOT NULL,
  summary TEXT,
  script JSONB NOT NULL DEFAULT '[]'::jsonb,
  key_vocabulary JSONB NOT NULL DEFAULT '[]'::jsonb,
  audio_mode TEXT NOT NULL DEFAULT 'on_demand' CHECK (audio_mode IN ('full','on_demand')),
  full_audio_url TEXT,
  line_durations JSONB,
  duration_seconds INTEGER,
  audio_status TEXT NOT NULL DEFAULT 'none' CHECK (audio_status IN ('none','pending','ready','failed')),
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_listen_episodes_dialect_created ON public.listen_episodes (dialect, created_at DESC);
CREATE INDEX idx_listen_episodes_format ON public.listen_episodes (format);
CREATE INDEX idx_listen_episodes_creator ON public.listen_episodes (creator_id);

GRANT SELECT, INSERT, UPDATE ON public.listen_episodes TO authenticated;
GRANT ALL ON public.listen_episodes TO service_role;

ALTER TABLE public.listen_episodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Episodes are readable by all authenticated users"
  ON public.listen_episodes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create episodes"
  ON public.listen_episodes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creator or admin can update episodes"
  ON public.listen_episodes FOR UPDATE TO authenticated
  USING (auth.uid() = creator_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Creator or admin can delete episodes"
  ON public.listen_episodes FOR DELETE TO authenticated
  USING (auth.uid() = creator_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_listen_episodes_updated_at
  BEFORE UPDATE ON public.listen_episodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Per-line cached audio (shared)
CREATE TABLE public.listen_line_audio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES public.listen_episodes(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,
  speaker TEXT,
  audio_url TEXT NOT NULL,
  duration_seconds NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (episode_id, line_index)
);

CREATE INDEX idx_listen_line_audio_episode ON public.listen_line_audio (episode_id, line_index);

GRANT SELECT ON public.listen_line_audio TO authenticated;
GRANT ALL ON public.listen_line_audio TO service_role;

ALTER TABLE public.listen_line_audio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Line audio readable by authenticated users"
  ON public.listen_line_audio FOR SELECT TO authenticated USING (true);

-- 3. Plays log
CREATE TABLE public.listen_episode_plays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES public.listen_episodes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  last_position_seconds NUMERIC NOT NULL DEFAULT 0,
  last_line_index INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (episode_id, user_id)
);

CREATE INDEX idx_listen_plays_user ON public.listen_episode_plays (user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.listen_episode_plays TO authenticated;
GRANT ALL ON public.listen_episode_plays TO service_role;

ALTER TABLE public.listen_episode_plays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own plays"
  ON public.listen_episode_plays FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own plays"
  ON public.listen_episode_plays FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update their own plays"
  ON public.listen_episode_plays FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete their own plays"
  ON public.listen_episode_plays FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_listen_plays_updated_at
  BEFORE UPDATE ON public.listen_episode_plays
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Play count incrementer (SECURITY DEFINER so any user can bump shared count)
CREATE OR REPLACE FUNCTION public.increment_listen_play_count(_episode_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.listen_episodes
    SET play_count = play_count + 1
    WHERE id = _episode_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_listen_play_count(UUID) TO authenticated;

-- 5. Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('listen-audio', 'listen-audio', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Listen audio publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'listen-audio');

CREATE POLICY "Service role manages listen audio"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'listen-audio')
  WITH CHECK (bucket_id = 'listen-audio');