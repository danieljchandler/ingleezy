
CREATE TABLE public.feature_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  feature text NOT NULL,
  event text NOT NULL,
  dialect text,
  status text NOT NULL DEFAULT 'ok',
  duration_ms integer,
  count integer,
  score numeric,
  user_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX feature_metrics_feature_created_idx ON public.feature_metrics (feature, created_at DESC);
CREATE INDEX feature_metrics_dialect_created_idx ON public.feature_metrics (dialect, created_at DESC);
CREATE INDEX feature_metrics_status_created_idx ON public.feature_metrics (status, created_at DESC);

GRANT SELECT, DELETE ON public.feature_metrics TO authenticated;
GRANT ALL ON public.feature_metrics TO service_role;

ALTER TABLE public.feature_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read feature metrics"
  ON public.feature_metrics FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete feature metrics"
  ON public.feature_metrics FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
