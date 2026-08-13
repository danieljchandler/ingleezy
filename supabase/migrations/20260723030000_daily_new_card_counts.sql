-- Server-persisted daily "new cards studied" counter, shared across the two
-- SRS review paths (curriculum word_reviews and personal user_vocabulary).
--
-- Previously the new-card cap (src/hooks/useNewCardCap.ts) was a client-only
-- preference re-applied fresh on every query load, so reloading the review
-- page reset it — a user could see far more than their configured "10 new
-- cards/day" by refreshing. The curriculum review path had no cap at all.
--
-- This is a pacing feature, not a security/cost boundary (unlike
-- usage_counters, which gates paid AI calls), so — unlike
-- increment_usage_counter — this RPC is safe to expose directly to
-- authenticated users for their own row.
CREATE TABLE public.daily_new_card_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

CREATE INDEX idx_daily_new_card_counts_user_day ON public.daily_new_card_counts (user_id, day);

GRANT SELECT ON public.daily_new_card_counts TO authenticated;
GRANT ALL ON public.daily_new_card_counts TO service_role;

ALTER TABLE public.daily_new_card_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own new-card counts"
  ON public.daily_new_card_counts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Atomic increment, scoped to the caller. Call once per card the FIRST time
-- it is actually rated (repetitions was 0 / no review row existed before),
-- not on every fetch/display — that keeps the count reload-proof and
-- immune to refetch inflation.
CREATE OR REPLACE FUNCTION public.increment_new_card_count(_amount integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_count integer;
BEGIN
  INSERT INTO public.daily_new_card_counts (user_id, day, count)
  VALUES (auth.uid(), (now() AT TIME ZONE 'utc')::date, _amount)
  ON CONFLICT (user_id, day)
  DO UPDATE SET count = daily_new_card_counts.count + _amount,
                updated_at = now()
  RETURNING count INTO _new_count;
  RETURN _new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_new_card_count(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.increment_new_card_count(integer) TO authenticated;
