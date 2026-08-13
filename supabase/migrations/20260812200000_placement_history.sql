-- Recurring placement (audit item C4). Placement used to be one-shot: the
-- quiz wrote a single level onto the profile and was never revisited, so a
-- learner six months in had XP and a streak but no evidence they'd moved from
-- A2 to B1. Every scored placement now appends here — written server-side by
-- placement-quiz at scoring time, so the trajectory is real assessment
-- history, not self-reported — and the Profile page plots it with a re-check
-- nudge every 90 days. This history is also the substrate the certification
-- product (D3) will attest against.
CREATE TABLE public.placement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  cefr_level text NOT NULL CHECK (cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  -- 0–100, the scorer's confidence in the band.
  confidence integer CHECK (confidence BETWEEN 0 AND 100),
  taken_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_placement_history_user
  ON public.placement_history (user_id, dialect, taken_at DESC);

ALTER TABLE public.placement_history ENABLE ROW LEVEL SECURITY;

-- Learners read their own trajectory; only the scoring function writes, so a
-- level on the chart is always one the assessment actually produced.
CREATE POLICY "Users read own placement history"
  ON public.placement_history FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.placement_history TO authenticated;
GRANT ALL ON public.placement_history TO service_role;
