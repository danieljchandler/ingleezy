-- External corpus sentences that ground dialect rule mining.
--
-- mine-dialect-corpus samples the platform's own published content. For Yemeni
-- that content is almost entirely AI-generated, so the miner reads back the
-- model's own output and promotes it to a rule that conditions the next
-- generation — a closed loop with no external input. This table is where real
-- attested speech enters: the Lisan Yemeni corpus (CC BY 4.0), ~1.05M annotated
-- tokens of which 5,000 sentences are sampled in docs/yemeni/sentences-sample.jsonl.
--
-- WHO WRITES: seeded by migration; `vetted` is written by the
-- vet-corpus-sentences edge function under the service role.
-- WHO READS: mine-dialect-corpus under the service role, and admins.
-- LEARNERS NEVER SEE THIS TABLE. There is no anon grant and no policy that
-- would produce one. The rows are scraped wartime Twitter — ~57% of them are
-- political by the derivation's own measure, and they contain factional slurs,
-- sectarian labels and obscenity. They exist to be *analysed* for grammar and
-- lexis, never rendered.
--
-- `vetted` is deliberately three-state:
--   NULL  = not yet judged. INERT — buildCorpus reads `vetted = true` only, so
--           seeding this table changes no generated content by itself.
--   true  = passed vetting, eligible for mining.
--   false = rejected.
-- Keyword filtering demonstrably cannot do this job: 38% of the sentences the
-- derivation marked non-political still hit an extended slur list, and hand
-- reading the survivors still finds slurs and obscenity. `keyword_flagged`
-- records the cheap pre-pass so the model pass can skip the obvious rejects
-- rather than pay to classify them — it is a cost optimisation, not the gate.

CREATE TABLE IF NOT EXISTS public.dialect_corpus_sentences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  text text NOT NULL,
  token_count integer,

  -- Provenance. `license` carries the CC BY 4.0 attribution obligation;
  -- authentic_stories is the precedent, though its anon SELECT grant is exactly
  -- what this table must not copy.
  source text NOT NULL DEFAULT 'lisan',
  license text NOT NULL DEFAULT 'CC BY 4.0',

  -- Vetting. NULL until judged; see the header.
  vetted boolean,
  vet_reason text,
  vetted_at timestamptz,

  -- Cheap pre-pass from the derivation's stop-list plus the extended slur list.
  keyword_flagged boolean NOT NULL DEFAULT false,

  -- PostgREST cannot ORDER BY random(), and `.limit(n)` with no ordering would
  -- hand back the same rows every run — so 95% of the pool would never be seen.
  -- Sampling filters on this column above a random threshold instead.
  sort_key double precision NOT NULL DEFAULT random(),

  created_at timestamptz NOT NULL DEFAULT now()
);

-- The mining path: dialect + vetted, ordered by the sampling key.
CREATE INDEX IF NOT EXISTS dialect_corpus_sentences_mining_idx
  ON public.dialect_corpus_sentences (dialect, vetted, sort_key);

-- The vetting path: find the next unjudged batch.
CREATE INDEX IF NOT EXISTS dialect_corpus_sentences_unvetted_idx
  ON public.dialect_corpus_sentences (dialect, keyword_flagged)
  WHERE vetted IS NULL;

-- Exact-duplicate guard so re-seeding cannot double the pool.
CREATE UNIQUE INDEX IF NOT EXISTS dialect_corpus_sentences_unique_idx
  ON public.dialect_corpus_sentences (dialect, md5(text));

ALTER TABLE public.dialect_corpus_sentences ENABLE ROW LEVEL SECURITY;

-- Grants: nothing to anon, ever. Edge functions use the service-role key, which
-- bypasses RLS; admins read through the policy below.
REVOKE ALL ON public.dialect_corpus_sentences FROM anon;
GRANT SELECT ON public.dialect_corpus_sentences TO authenticated;
GRANT ALL ON public.dialect_corpus_sentences TO service_role;

-- Policies follow 20260723000000_tighten_telemetry_insert_rls.sql, which exists
-- because `WITH CHECK (true)` policies with no role restriction let any browser
-- forge rows using the anon key that ships in the bundle. Writes are
-- service_role only; there is no legitimate client-side write here.
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
