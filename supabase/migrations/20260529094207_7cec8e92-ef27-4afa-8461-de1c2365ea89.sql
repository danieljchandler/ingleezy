
CREATE TABLE public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key, day)
);

CREATE INDEX idx_usage_counters_user_day ON public.usage_counters (user_id, day);

GRANT SELECT ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_counters TO service_role;

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own usage counters"
  ON public.usage_counters
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Atomic increment helper. SECURITY DEFINER so edge functions
-- (service role) can bump counters without race conditions.
CREATE OR REPLACE FUNCTION public.increment_usage_counter(
  _user_id uuid,
  _key text,
  _amount integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_count integer;
BEGIN
  INSERT INTO public.usage_counters (user_id, key, day, count)
  VALUES (_user_id, _key, (now() AT TIME ZONE 'utc')::date, _amount)
  ON CONFLICT (user_id, key, day)
  DO UPDATE SET count = usage_counters.count + _amount,
                updated_at = now()
  RETURNING count INTO _new_count;
  RETURN _new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_usage_counter(uuid, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage_counter(uuid, text, integer) TO service_role;
