-- English retarget: listen episodes are English now; the learner-facing
-- title also gets a dialect-Arabic rendering.
ALTER TABLE public.listen_episodes
  ADD COLUMN IF NOT EXISTS title_arabic text;
