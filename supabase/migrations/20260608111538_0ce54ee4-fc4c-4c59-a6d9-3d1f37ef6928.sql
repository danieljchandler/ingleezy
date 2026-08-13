CREATE TABLE IF NOT EXISTS public.feature_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  metric_id uuid REFERENCES public.feature_metrics(id) ON DELETE SET NULL,
  feature text NOT NULL,
  event text NOT NULL,
  dialect text,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'error',
  message text NOT NULL,
  meta jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid
);

CREATE INDEX IF NOT EXISTS feature_alerts_created_idx ON public.feature_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS feature_alerts_unack_idx ON public.feature_alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

GRANT SELECT, UPDATE ON public.feature_alerts TO authenticated;
GRANT ALL ON public.feature_alerts TO service_role;

ALTER TABLE public.feature_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read alerts" ON public.feature_alerts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins acknowledge alerts" ON public.feature_alerts FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public._alert_from_metric()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _type text;
  _sev  text;
  _msg  text;
BEGIN
  IF NEW.status = 'error' THEN
    _type := COALESCE(NULLIF(NEW.event, ''), 'error');
    _sev  := CASE WHEN NEW.event IN ('config_missing', 'request_failed') THEN 'critical' ELSE 'error' END;
    _msg  := format('[%s/%s] %s error%s', NEW.feature, NEW.event, COALESCE(NEW.dialect, 'all'),
                    CASE WHEN NEW.meta ? 'error' THEN ': ' || left(NEW.meta->>'error', 160) ELSE '' END);
    INSERT INTO public.feature_alerts(metric_id, feature, event, dialect, alert_type, severity, message, meta)
    VALUES (NEW.id, NEW.feature, NEW.event, NEW.dialect, _type, _sev, _msg, NEW.meta);
    RETURN NEW;
  END IF;

  IF NEW.event = 'firecrawl_search' AND COALESCE(NEW.count, 0) = 0 THEN
    INSERT INTO public.feature_alerts(metric_id, feature, event, dialect, alert_type, severity, message, meta)
    VALUES (NEW.id, NEW.feature, NEW.event, NEW.dialect, 'firecrawl_drop', 'warn',
            format('[%s] Firecrawl returned 0 results for %s (tbs=%s)', NEW.feature, COALESCE(NEW.dialect, 'all'), COALESCE(NEW.meta->>'tbs', 'none')),
            NEW.meta);
    RETURN NEW;
  END IF;

  IF NEW.event = 'no_articles' THEN
    INSERT INTO public.feature_alerts(metric_id, feature, event, dialect, alert_type, severity, message, meta)
    VALUES (NEW.id, NEW.feature, NEW.event, NEW.dialect, 'no_articles', 'error',
            format('[%s] No articles after all fallbacks for %s', NEW.feature, COALESCE(NEW.dialect, 'all')),
            NEW.meta);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_from_metric ON public.feature_metrics;
CREATE TRIGGER trg_alert_from_metric AFTER INSERT ON public.feature_metrics FOR EACH ROW EXECUTE FUNCTION public._alert_from_metric();

ALTER PUBLICATION supabase_realtime ADD TABLE public.feature_alerts;
ALTER TABLE public.feature_alerts REPLICA IDENTITY FULL;