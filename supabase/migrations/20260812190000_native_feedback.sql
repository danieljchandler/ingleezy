-- Paid native feedback (audit item D2). The half-built infrastructure — the
-- dialect_native_reviews queue, the content_reviewer seat, the admin review
-- tab — becomes sellable: a learner spends a credit to submit a piece of
-- dialect writing, a native speaker answers it in the SAME queue reviewers
-- already work (source 'paid_feedback'), and the answer propagates back to a
-- learner-readable table by trigger. No new reviewer UI, no second queue.

-- Credits are a ledger, not a counter: every grant, spend and refund is a row,
-- balance is a sum, and a Stripe session can be credited exactly once.
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

-- The learner-facing side of a request. The reviewer never touches this
-- table: they answer in dialect_native_reviews and the trigger below mirrors
-- the answer here.
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

-- When a reviewer settles a paid review — corrected or dismissed — the answer
-- flows back to the learner's request, and a dismissal refunds the credit.
-- The linkage is metadata->>'feedback_request_id', written at submission.
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
  IF NOT FOUND THEN RETURN NEW; END IF; -- already settled: idempotent

  IF NEW.status = 'corrected' AND NEW.corrected_text IS NOT NULL AND btrim(NEW.corrected_text) <> '' THEN
    UPDATE public.native_feedback_requests
    SET status = 'answered',
        response_text = NEW.corrected_text,
        reviewer_notes = NEW.reviewer_notes,
        review_id = NEW.id,
        answered_at = now()
    WHERE id = request_id;
  ELSE
    -- Dismissed, or corrected with nothing to say: the learner gets the
    -- credit back rather than paying for silence.
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
