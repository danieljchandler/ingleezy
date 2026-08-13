DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable — content_embeddings not created; semantic features disabled';
    RETURN;
  END;

  CREATE TABLE IF NOT EXISTS public.content_embeddings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN ('video_line', 'vocabulary_word', 'corpus_sentence')),
    source_id uuid NOT NULL,
    chunk_index integer NOT NULL DEFAULT 0,
    dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
    content text NOT NULL,
    embedding vector(1536) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, source_id, chunk_index)
  );

  CREATE INDEX IF NOT EXISTS idx_content_embeddings_ann
    ON public.content_embeddings USING hnsw (embedding vector_cosine_ops);
  CREATE INDEX IF NOT EXISTS idx_content_embeddings_kind
    ON public.content_embeddings (kind, dialect);

  ALTER TABLE public.content_embeddings ENABLE ROW LEVEL SECURITY;
  GRANT ALL ON public.content_embeddings TO service_role;

  CREATE OR REPLACE FUNCTION public.match_content(
    query_embedding vector(1536),
    match_kind text DEFAULT NULL,
    match_dialect text DEFAULT NULL,
    match_count integer DEFAULT 20
  )
  RETURNS TABLE (
    kind text,
    source_id uuid,
    chunk_index integer,
    dialect text,
    content text,
    similarity double precision
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $match$
    SELECT
      ce.kind,
      ce.source_id,
      ce.chunk_index,
      ce.dialect,
      ce.content,
      1 - (ce.embedding <=> query_embedding) AS similarity
    FROM public.content_embeddings ce
    WHERE (match_kind IS NULL OR ce.kind = match_kind)
      AND (match_dialect IS NULL OR ce.dialect = match_dialect)
    ORDER BY ce.embedding <=> query_embedding
    LIMIT LEAST(GREATEST(match_count, 1), 100)
  $match$;

  REVOKE ALL ON FUNCTION public.match_content(vector, text, text, integer) FROM public, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.match_content(vector, text, text, integer) TO service_role;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS desired_retention numeric
  CHECK (desired_retention IS NULL OR (desired_retention >= 0.7 AND desired_retention <= 0.97));

ALTER TABLE public.dialect_rules
  DROP CONSTRAINT IF EXISTS dialect_rules_source_check;
ALTER TABLE public.dialect_rules
  ADD CONSTRAINT dialect_rules_source_check
  CHECK (source IN ('manual', 'ai_generated', 'corpus_mined', 'flywheel_gold'));

CREATE TABLE public.referral_codes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own referral code"
  ON public.referral_codes FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.referral_codes TO authenticated;
GRANT ALL ON public.referral_codes TO service_role;

CREATE TABLE public.referral_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'rewarded')),
  converted_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_id <> referred_user_id)
);

CREATE INDEX idx_referral_redemptions_referrer
  ON public.referral_redemptions (referrer_id, created_at DESC);

ALTER TABLE public.referral_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants read own redemptions"
  ON public.referral_redemptions FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR referred_user_id = auth.uid());

GRANT SELECT ON public.referral_redemptions TO authenticated;
GRANT ALL ON public.referral_redemptions TO service_role;

CREATE TABLE public.native_feedback_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK (delta <> 0),
  reason text NOT NULL CHECK (reason IN ('purchase', 'submit', 'refund', 'grant')),
  stripe_session_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_native_feedback_credits_user
  ON public.native_feedback_credits (user_id, created_at DESC);

ALTER TABLE public.native_feedback_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own credit ledger"
  ON public.native_feedback_credits FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.native_feedback_credits TO authenticated;
GRANT ALL ON public.native_feedback_credits TO service_role;

CREATE TABLE public.native_feedback_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  kind text NOT NULL DEFAULT 'writing' CHECK (kind IN ('writing')),
  text text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'declined')),
  response_text text,
  reviewer_notes text,
  review_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);

CREATE INDEX idx_native_feedback_requests_user
  ON public.native_feedback_requests (user_id, created_at DESC);

ALTER TABLE public.native_feedback_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own feedback requests"
  ON public.native_feedback_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.native_feedback_requests TO authenticated;
GRANT ALL ON public.native_feedback_requests TO service_role;

CREATE OR REPLACE FUNCTION public.settle_native_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  request_id uuid;
  request_row public.native_feedback_requests%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('corrected', 'dismissed') THEN RETURN NEW; END IF;
  IF NEW.metadata IS NULL OR NEW.metadata->>'feedback_request_id' IS NULL THEN RETURN NEW; END IF;
  request_id := (NEW.metadata->>'feedback_request_id')::uuid;

  SELECT * INTO request_row FROM public.native_feedback_requests
  WHERE id = request_id AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.status = 'corrected' AND NEW.corrected_text IS NOT NULL AND btrim(NEW.corrected_text) <> '' THEN
    UPDATE public.native_feedback_requests
    SET status = 'answered',
        response_text = NEW.corrected_text,
        reviewer_notes = NEW.reviewer_notes,
        review_id = NEW.id,
        answered_at = now()
    WHERE id = request_id;
  ELSE
    UPDATE public.native_feedback_requests
    SET status = 'declined',
        reviewer_notes = NEW.reviewer_notes,
        review_id = NEW.id,
        answered_at = now()
    WHERE id = request_id;
    INSERT INTO public.native_feedback_credits (user_id, delta, reason)
    VALUES (request_row.user_id, 1, 'refund');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_native_feedback ON public.dialect_native_reviews;
CREATE TRIGGER trg_settle_native_feedback
  AFTER UPDATE ON public.dialect_native_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.settle_native_feedback();

CREATE TABLE public.placement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  cefr_level text NOT NULL CHECK (cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  confidence integer CHECK (confidence BETWEEN 0 AND 100),
  taken_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_placement_history_user
  ON public.placement_history (user_id, dialect, taken_at DESC);

ALTER TABLE public.placement_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own placement history"
  ON public.placement_history FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.placement_history TO authenticated;
GRANT ALL ON public.placement_history TO service_role;

ALTER TABLE public.learner_errors
  DROP CONSTRAINT IF EXISTS learner_errors_source_check;
ALTER TABLE public.learner_errors
  ADD CONSTRAINT learner_errors_source_check
  CHECK (source IN (
    'pronunciation', 'shadow', 'sentence_coach', 'set_phrase_voice', 'quiz',
    'writing'
  ));