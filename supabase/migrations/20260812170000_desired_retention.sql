-- FSRS personalisation (C2): the learner's retention target. The scheduler
-- stores stability as "days until recall drops to 90%" and until now always
-- scheduled at exactly that point; this dial converts the same stability to
-- an interval for the learner's own target — lower means fewer, longer
-- reviews with more forgetting; higher means the reverse. Read by the client
-- schedulers via useDesiredRetention; written from Settings.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS desired_retention numeric
  CHECK (desired_retention IS NULL OR (desired_retention >= 0.7 AND desired_retention <= 0.97));
