-- lessons.status, dated before its first reader. The column reached
-- production through a platform snapshot and was recovered into the tracked
-- history in 20260816090000 — but 20260529150401's "Anyone can view published
-- lessons" policy references it, and a policy is validated at CREATE time, so
-- on a from-scratch replay the recovery arrived three months too late and the
-- May migration died on it. Same definition as the recovery (which stays, as
-- a no-op); IF NOT EXISTS so every ordering is safe.
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
