-- Learner error corpus + the profile fields that personalise generation.
--
-- The app already produces a lot of high-quality error data and throws all of
-- it away: azure-pronunciation returns per-phoneme error types,
-- score-shadow-attempt returns a per-word alignment diff, practice-sentence-coach
-- returns a natural rewrite plus targeted tips, score-set-phrase-voice returns an
-- ASR similarity against the canonical phrase. Every one of those is rendered
-- once and discarded, so nothing accumulates and nothing can be remediated.
--
-- This table is the corpus. It feeds two things:
--   1. the `weak` set in _shared/learnerProfile.ts, so generated content
--      deliberately recycles what the learner keeps getting wrong;
--   2. future targeted drills.
--
-- Rows are written by edge functions under the service role (the scoring
-- functions already run there), and read by their owner.

CREATE TABLE public.learner_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL DEFAULT 'Gulf',
  -- Which scoring surface produced this.
  source text NOT NULL CHECK (source IN (
    'pronunciation', 'shadow', 'sentence_coach', 'set_phrase_voice', 'quiz'
  )),
  -- What the learner was aiming for, and what actually came out. `produced`
  -- is nullable because some sources (quiz) have no utterance.
  target_arabic text NOT NULL,
  produced_arabic text,
  -- Coarse bucket for grouping: 'mispronunciation' | 'omission' | 'insertion' |
  -- 'wrong_word' | 'word_order' | 'msa_leak' | 'other'. Deliberately free text
  -- rather than an enum — the scorers disagree on taxonomy and a new source
  -- should not need a migration.
  error_kind text NOT NULL DEFAULT 'other',
  -- Provider-shaped payload (phoneme scores, word alignment, coach tips).
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Optional links back to the card this error is about, so the weak set can
  -- be joined to a deck rather than matched on string equality.
  word_id uuid REFERENCES public.vocabulary_words(id) ON DELETE SET NULL,
  user_vocabulary_id uuid REFERENCES public.user_vocabulary(id) ON DELETE CASCADE,
  -- Set once the learner has demonstrably fixed it, so the weak set decays.
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The read pattern is always "recent unresolved errors for this user+dialect".
CREATE INDEX idx_learner_errors_user_recent
  ON public.learner_errors (user_id, dialect, created_at DESC)
  WHERE resolved_at IS NULL;

GRANT SELECT, UPDATE ON public.learner_errors TO authenticated;
GRANT ALL ON public.learner_errors TO service_role;

ALTER TABLE public.learner_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own errors"
  ON public.learner_errors
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users may only resolve/dismiss their own rows; inserts come from the
-- scoring edge functions under the service role, which bypasses RLS.
CREATE POLICY "Users can resolve their own errors"
  ON public.learner_errors
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- Interests, alongside the already-existing-but-unused profiles.learning_reason.
-- Onboarding captures only goal *intensity* today (casual/regular/serious), which
-- says nothing about what the learner wants to talk about or why. Both fields
-- feed the learner profile that generated content is conditioned on.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}'::text[];
