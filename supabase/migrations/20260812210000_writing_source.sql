-- Written production (C3): the writing coach records what the learner typed
-- wrong, so written errors feed the same weak-set loop as spoken ones.
--
-- The source CHECK exists twice in the migration history (20260726100000 and
-- the consolidated 20260802172036, both inline and therefore auto-named), so
-- drop-and-recreate is the only shape that replays cleanly on both.
ALTER TABLE public.learner_errors
  DROP CONSTRAINT IF EXISTS learner_errors_source_check;
ALTER TABLE public.learner_errors
  ADD CONSTRAINT learner_errors_source_check
  CHECK (source IN (
    'pronunciation', 'shadow', 'sentence_coach', 'set_phrase_voice', 'quiz',
    'writing'
  ));
