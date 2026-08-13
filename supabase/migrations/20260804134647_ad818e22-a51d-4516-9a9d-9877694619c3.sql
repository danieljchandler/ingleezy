CREATE TABLE IF NOT EXISTS public.dialect_corpus_sentences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  text text NOT NULL,
  token_count integer,
  source text NOT NULL DEFAULT 'lisan',
  license text NOT NULL DEFAULT 'CC BY 4.0',
  vetted boolean,
  vet_reason text,
  vetted_at timestamptz,
  keyword_flagged boolean NOT NULL DEFAULT false,
  sort_key double precision NOT NULL DEFAULT random(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dialect_corpus_sentences_mining_idx
  ON public.dialect_corpus_sentences (dialect, vetted, sort_key);

CREATE INDEX IF NOT EXISTS dialect_corpus_sentences_unvetted_idx
  ON public.dialect_corpus_sentences (dialect, keyword_flagged)
  WHERE vetted IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dialect_corpus_sentences_unique_idx
  ON public.dialect_corpus_sentences (dialect, md5(text));

REVOKE ALL ON public.dialect_corpus_sentences FROM anon;
GRANT SELECT ON public.dialect_corpus_sentences TO authenticated;
GRANT ALL ON public.dialect_corpus_sentences TO service_role;

ALTER TABLE public.dialect_corpus_sentences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read corpus sentences" ON public.dialect_corpus_sentences;
CREATE POLICY "Admins read corpus sentences"
  ON public.dialect_corpus_sentences
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Service role writes corpus sentences" ON public.dialect_corpus_sentences;
CREATE POLICY "Service role writes corpus sentences"
  ON public.dialect_corpus_sentences
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);