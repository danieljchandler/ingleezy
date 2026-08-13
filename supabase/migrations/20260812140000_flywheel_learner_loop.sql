-- Flywheel F5/F6 (docs/improvement-plan-2026-08.md): the learner-facing intake
-- and the first loop-back wires.

-- ── W5: learner audio contribution is opt-in, off by default ─────────────────
-- Pronunciation and shadowing clips were always scored and discarded. With
-- consent (Settings toggle + Terms section shipped alongside this migration),
-- a learner can choose to have their clips retained as training data —
-- accented Arabic paired with a known target text is scarce and valuable for
-- robust-ASR work. The flag lives on the profile so every scoring function can
-- read one place.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contribute_audio boolean NOT NULL DEFAULT false;

-- Private bucket for contributed clips; keyed {user_id}/{uuid}.webm so a
-- deletion request is one prefix removal.
INSERT INTO storage.buckets (id, name, public)
VALUES ('learner-audio', 'learner-audio', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins read learner audio"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'learner-audio' AND public.is_admin());

-- Contributed rows carry a fifth corrector role: the learner themself.
ALTER TABLE public.training_examples
  DROP CONSTRAINT IF EXISTS training_examples_corrector_role_check;
ALTER TABLE public.training_examples
  ADD CONSTRAINT training_examples_corrector_role_check CHECK (corrector_role IN
    ('native_speaker', 'content_reviewer', 'admin', 'auto_repair', 'learner'));

-- ── F6 wire 1: gold corrections grow the vetted few-shot corpus ──────────────
-- dialect_corpus_sentences (vetted = true) is what mine-dialect-corpus and the
-- generators draw few-shot examples from. A sentence a native speaker or
-- content reviewer corrected is the highest-signal example the corpus can
-- hold, so gold pairs flow in automatically. Guarded to sentence-sized text —
-- the corpus wants sentences, not paragraphs — and deduped by the corpus's
-- own (dialect, md5(text)) unique index.
CREATE OR REPLACE FUNCTION public.corpus_sentence_from_gold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  sentence text;
  tokens integer;
BEGIN
  IF NEW.tier = 'gold' AND NEW.task_type IN ('generation', 'asr') THEN
    sentence := btrim(NEW.human_output);
    tokens := array_length(regexp_split_to_array(sentence, '\s+'), 1);
    IF tokens BETWEEN 2 AND 60 THEN
      INSERT INTO public.dialect_corpus_sentences
        (dialect, text, token_count, source, license, vetted, vet_reason, vetted_at)
      VALUES
        (NEW.dialect, sentence, tokens, 'flywheel_gold', 'internal',
         true, 'human corrected (' || NEW.corrector_role || ')', now())
      ON CONFLICT (dialect, md5(text)) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_corpus_sentence_from_gold ON public.training_examples;
CREATE TRIGGER trg_corpus_sentence_from_gold
  AFTER INSERT ON public.training_examples
  FOR EACH ROW
  EXECUTE FUNCTION public.corpus_sentence_from_gold();

-- ── F6 wire 2: per-engine correction rates ───────────────────────────────────
-- Every ASR pair records which engines produced the text a human had to fix
-- (training_examples.engines, copied from discover_videos.engines_used). This
-- view answers the audit's open pilot questions — is Azure's leg still earning
-- its slot, is Cohere better — with data instead of vibes.
-- security_invoker so the underlying table's admin-only RLS applies.
CREATE OR REPLACE VIEW public.asr_engine_corrections
WITH (security_invoker = true) AS
SELECT
  te.dialect,
  eng.value AS engine,
  date_trunc('week', te.created_at) AS week,
  count(*) AS corrected_lines
FROM public.training_examples te
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(te.engines) = 'array' THEN te.engines
    WHEN jsonb_typeof(te.engines -> 'asr') = 'array' THEN te.engines -> 'asr'
    ELSE '[]'::jsonb
  END
) AS eng(value)
WHERE te.task_type = 'asr'
GROUP BY te.dialect, eng.value, date_trunc('week', te.created_at);

GRANT SELECT ON public.asr_engine_corrections TO authenticated;
