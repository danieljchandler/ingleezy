
CREATE TABLE public.dialect_native_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialect text NOT NULL,
  content_type text NOT NULL DEFAULT 'manual',
  content_id uuid,
  original_text text NOT NULL,
  corrected_text text,
  reviewer_notes text,
  status text NOT NULL DEFAULT 'pending', -- pending | corrected | dismissed
  source text NOT NULL DEFAULT 'manual',   -- user_report | native_validator | msa_leak_detector | manual
  violation_id uuid,
  source_function text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dialect_native_reviews_status ON public.dialect_native_reviews (status, dialect, created_at DESC);
CREATE INDEX idx_dialect_native_reviews_violation ON public.dialect_native_reviews (violation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dialect_native_reviews TO authenticated;
GRANT ALL ON public.dialect_native_reviews TO service_role;

ALTER TABLE public.dialect_native_reviews ENABLE ROW LEVEL SECURITY;

-- Admins: full management
CREATE POLICY "Admins manage native reviews"
ON public.dialect_native_reviews
FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- Recorders: can read and update (triage + correct), but not delete or insert arbitrarily
CREATE POLICY "Recorders can read native reviews"
ON public.dialect_native_reviews
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'recorder'::app_role));

CREATE POLICY "Recorders can update native reviews"
ON public.dialect_native_reviews
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'recorder'::app_role))
WITH CHECK (has_role(auth.uid(), 'recorder'::app_role));

-- Auto-update updated_at
CREATE TRIGGER trg_dialect_native_reviews_updated_at
BEFORE UPDATE ON public.dialect_native_reviews
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
