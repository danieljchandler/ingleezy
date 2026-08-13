ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contribute_audio boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Admins read learner audio" ON storage.objects;
CREATE POLICY "Admins read learner audio"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'learner-audio' AND public.is_admin());

ALTER TABLE public.training_examples
  DROP CONSTRAINT IF EXISTS training_examples_corrector_role_check;
ALTER TABLE public.training_examples
  ADD CONSTRAINT training_examples_corrector_role_check CHECK (corrector_role IN
    ('native_speaker', 'content_reviewer', 'admin', 'auto_repair', 'learner'));

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