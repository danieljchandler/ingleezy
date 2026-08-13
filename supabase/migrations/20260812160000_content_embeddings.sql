-- Semantic content index (Sprint 3 / audit item B1). Embeddings unlock what
-- keyword search cannot: matching content to a learner's weak words, "more
-- like this", and semantic dedupe over the corpus. One table holds every
-- embedded kind, so one RPC answers similarity across all of them.
--
-- The whole migration is guarded: pgvector ships on Supabase but NOT on the
-- vanilla postgres:16 container the CI contract job replays against, so on a
-- database without the extension this migration logs a notice and creates
-- nothing. Code that reads these objects (embed-content, match_content
-- callers) degrades to "no semantic features", never to an error page.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable — content_embeddings not created; semantic features disabled';
    RETURN;
  END;

  -- text-embedding-3-small dimensions. Changing models means re-embedding
  -- everything anyway, so the dimension is fixed rather than parameterized.
  CREATE TABLE IF NOT EXISTS public.content_embeddings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN ('video_line', 'vocabulary_word', 'corpus_sentence')),
    source_id uuid NOT NULL,
    -- Line index within the source (0 for single-chunk kinds).
    chunk_index integer NOT NULL DEFAULT 0,
    dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
    -- What was embedded (Arabic first, translation appended when there is
    -- one — bilingual text lets English queries land on Arabic content).
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
  -- Service-role only: embeddings are infrastructure, not user data. Reads
  -- reach learners through edge functions that decide what similarity means
  -- for their feature.
  GRANT ALL ON public.content_embeddings TO service_role;

  -- Nearest content to a query vector, cosine distance. SECURITY DEFINER +
  -- service-role-only EXECUTE: features call this from edge functions.
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
