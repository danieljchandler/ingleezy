-- The training-data flywheel's canonical store (docs/improvement-plan-2026-08.md,
-- Part 2). Every human correction the app receives — a native speaker fixing a
-- transcript line, a reviewer correcting a generated phrase — becomes one
-- provenance-stamped row here, aligned to its audio when there is audio.
-- Corrections used to be applied destructively (the transcript editor's undo
-- stack died on save); this table is where that labour accumulates instead.
CREATE TABLE public.training_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL CHECK (task_type IN
    ('asr', 'translation', 'generation', 'diacritization', 'pronunciation', 'dialect_id')),
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),

  -- The pair. machine_output is what a model or engine produced; human_output
  -- is what a person made of it. context carries whatever the capture point
  -- knew (surrounding lines, the prompt, the translation) as data, not schema.
  machine_output text NOT NULL,
  human_output text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Audio alignment, null for text-only tasks. Offsets index into the object
  -- at (audio_bucket, audio_path) — audio stays single-copy in storage and
  -- exports carry references, not slices.
  audio_bucket text,
  audio_path text,
  audio_start_ms integer,
  audio_end_ms integer,

  -- Provenance: where the pair came from and which machinery was wrong.
  source_table text NOT NULL,
  source_id uuid,
  source_function text,
  engines jsonb,
  corrector_role text NOT NULL CHECK (corrector_role IN
    ('native_speaker', 'content_reviewer', 'admin', 'auto_repair')),
  corrector_id uuid,

  -- Quality and governance. gold = native speaker / content reviewer;
  -- silver = admin; bronze = automated (the MSA repair pass). source_license
  -- classifies the origin so any export can filter to what a given training
  -- use permits; pii_reviewed gates conversation-derived text out of exports
  -- until scrubbed.
  tier text NOT NULL CHECK (tier IN ('gold', 'silver', 'bronze')),
  source_license text NOT NULL DEFAULT 'internal',
  pii_reviewed boolean NOT NULL DEFAULT false,

  -- Stamped by the export script; makes "everything since the last export"
  -- one query and any past dataset reconstructable.
  export_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_examples_export
  ON public.training_examples (task_type, dialect, tier, created_at);
CREATE INDEX idx_training_examples_unexported
  ON public.training_examples (created_at) WHERE export_batch_id IS NULL;
-- One review correction maps to one row; the trigger below relies on this to
-- stay idempotent when a review row is touched again after correction. Scoped
-- to reviews only — a transcript save legitimately writes many rows that all
-- share the video as their source_id.
CREATE UNIQUE INDEX idx_training_examples_review_source
  ON public.training_examples (source_id)
  WHERE source_table = 'dialect_native_reviews';

ALTER TABLE public.training_examples ENABLE ROW LEVEL SECURITY;

-- Admins read (the dashboard's flywheel card); the service role writes.
-- Learners never see this table — their reports only become training data
-- after a native speaker corrects them, over in dialect_native_reviews.
CREATE POLICY "Admins read training examples"
  ON public.training_examples FOR SELECT TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.training_examples TO authenticated;
GRANT ALL ON public.training_examples TO service_role;

-- Private bucket for versioned export snapshots (JSONL + audio manifests).
INSERT INTO storage.buckets (id, name, public)
VALUES ('training-exports', 'training-exports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins read training exports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'training-exports' AND public.is_admin());

-- ── W2: native-review corrections flow in automatically ─────────────────────
-- dialect_native_reviews is where MSA-leak flags, validator failures and user
-- reports queue for a native speaker. The moment one transitions to
-- 'corrected' with actual corrected text, the pair is training data — gold,
-- because a human who knows the dialect wrote the correction.
CREATE OR REPLACE FUNCTION public.training_example_from_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'corrected'
     AND NEW.corrected_text IS NOT NULL
     AND btrim(NEW.corrected_text) <> ''
     AND NEW.corrected_text IS DISTINCT FROM NEW.original_text
     AND (OLD.status IS DISTINCT FROM 'corrected' OR OLD.corrected_text IS DISTINCT FROM NEW.corrected_text)
     AND NEW.dialect IN ('Gulf', 'Egyptian', 'Yemeni')
  THEN
    INSERT INTO public.training_examples (
      task_type, dialect, machine_output, human_output, context,
      source_table, source_id, source_function,
      corrector_role, corrector_id, tier
    ) VALUES (
      'generation',
      NEW.dialect,
      NEW.original_text,
      NEW.corrected_text,
      jsonb_build_object(
        'review_source', NEW.source,
        'reviewer_notes', NEW.reviewer_notes,
        'metadata', NEW.metadata
      ),
      'dialect_native_reviews',
      NEW.id,
      NEW.source_function,
      'native_speaker',
      NEW.reviewer_id,
      'gold'
    )
    ON CONFLICT (source_id) WHERE source_table = 'dialect_native_reviews'
    DO UPDATE SET
      human_output = EXCLUDED.human_output,
      context = EXCLUDED.context,
      corrector_id = EXCLUDED.corrector_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_example_from_review ON public.dialect_native_reviews;
CREATE TRIGGER trg_training_example_from_review
  AFTER UPDATE ON public.dialect_native_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.training_example_from_review();

-- Backfill: corrections that happened before the flywheel existed.
INSERT INTO public.training_examples (
  task_type, dialect, machine_output, human_output, context,
  source_table, source_id, source_function, corrector_role, corrector_id, tier, created_at
)
SELECT
  'generation',
  r.dialect,
  r.original_text,
  r.corrected_text,
  jsonb_build_object('review_source', r.source, 'reviewer_notes', r.reviewer_notes, 'metadata', r.metadata),
  'dialect_native_reviews',
  r.id,
  r.source_function,
  'native_speaker',
  r.reviewer_id,
  'gold',
  r.updated_at
FROM public.dialect_native_reviews r
WHERE r.status = 'corrected'
  AND r.corrected_text IS NOT NULL
  AND btrim(r.corrected_text) <> ''
  AND r.corrected_text IS DISTINCT FROM r.original_text
  AND r.dialect IN ('Gulf', 'Egyptian', 'Yemeni')
ON CONFLICT (source_id) WHERE source_table = 'dialect_native_reviews'
DO NOTHING;
