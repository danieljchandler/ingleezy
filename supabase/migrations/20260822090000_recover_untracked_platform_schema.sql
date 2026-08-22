-- The rest of the schema the platform created and no migration ever did.
--
-- 20260529150400 recovered the two tables that made a migration *fail*, which
-- is how they were found: something errored, and the error named them. This
-- file is the other half — schema whose absence errors nothing during a
-- rebuild, so replaying the migrations reported a clean run and still produced
-- a database the app cannot use.
--
-- Found by diffing `src/integrations/supabase/types.ts` (generated from the
-- real database) against the schema a full replay actually produces, table by
-- table and column by column. `migrationReplay` now makes that diff on every
-- CI run for everything the app queries, so this class of drift cannot
-- reaccumulate silently.
--
-- Everything is `IF NOT EXISTS` or drop-then-create, so against the database
-- this schema already lives in the whole file is a no-op.

-- ─── user_difficulty ─────────────────────────────────────────────────────────
-- Per-learner skill estimates, read by `useAnalytics` for the skill radar. The
-- scale is 0..1: the hook falls back to `|| 0.5` for every axis, so 0.5 is the
-- neutral value the app already assumes and the right column default.
--
-- Nothing in the app writes it — the four `*_history` columns and the estimates
-- are written server-side — so the client policy below is SELECT only. The
-- service role bypasses RLS and is unaffected.
CREATE TABLE IF NOT EXISTS public.user_difficulty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vocab_difficulty numeric NOT NULL DEFAULT 0.5,
  listening_difficulty numeric NOT NULL DEFAULT 0.5,
  reading_difficulty numeric NOT NULL DEFAULT 0.5,
  speaking_difficulty numeric NOT NULL DEFAULT 0.5,
  vocab_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  listening_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  reading_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  speaking_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- `.eq("user_id", …).maybeSingle()`, so one row per learner or the read errors.
CREATE UNIQUE INDEX IF NOT EXISTS user_difficulty_user_id_key
  ON public.user_difficulty (user_id);

ALTER TABLE public.user_difficulty ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own difficulty" ON public.user_difficulty;
CREATE POLICY "Users can view their own difficulty"
  ON public.user_difficulty FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ─── weekly_recommendations ──────────────────────────────────────────────────
-- The weekly nudge `useSmartNotifications` reads. Same posture: read by the
-- browser, written server-side, so SELECT only. `learning_path_id` carries no
-- foreign key because `learning_paths` is not created here — see the note at
-- the foot of this file.
CREATE TABLE IF NOT EXISTS public.weekly_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  learning_path_id uuid,
  focus_areas jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_content jsonb NOT NULL DEFAULT '[]'::jsonb,
  vocab_to_review jsonb NOT NULL DEFAULT '[]'::jsonb,
  performance_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty_adjustment text,
  motivation_message text,
  motivation_message_arabic text,
  viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS weekly_recommendations_user_week_idx
  ON public.weekly_recommendations (user_id, week_start DESC);

ALTER TABLE public.weekly_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own recommendations" ON public.weekly_recommendations;
CREATE POLICY "Users can view their own recommendations"
  ON public.weekly_recommendations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- `viewed_at` is the one field the client stamps, so it needs UPDATE as well.
DROP POLICY IF EXISTS "Users can mark their own recommendations viewed" ON public.weekly_recommendations;
CREATE POLICY "Users can mark their own recommendations viewed"
  ON public.weekly_recommendations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- ─── Columns the two review tables were missing ──────────────────────────────
-- These are the ones that actually break a learner. `SaveUnknownsBar` and the
-- Anki importer both write `stage` / `review_count` / `correct_count`, and
-- PostgREST rejects an insert naming a column that does not exist — so on a
-- rebuilt database saving a word from a transcript fails outright, and an Anki
-- import fails for every card in the deck.
--
-- `stage` defaults to 'NEW' because that is what `mapAnkiSchedule` returns for
-- an unseen card, and an unseen card is what a row with no stage is.
ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_result text,
  ADD COLUMN IF NOT EXISTS sentence_text text,
  ADD COLUMN IF NOT EXISTS sentence_english text;

ALTER TABLE public.word_reviews
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_result text;

-- ─── curriculum_chat_approvals.created_at ────────────────────────────────────
-- 20260304100000 creates the table without it; the real one has it. Nothing
-- queries it today, which is why it never surfaced as a failure — it is here so
-- the diff that found it comes back empty rather than nearly empty.
ALTER TABLE public.curriculum_chat_approvals
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ─── Two the diff reports that are deliberately not here ─────────────────────
--
-- `content_embeddings` is created by 20260812160000, guarded on the pgvector
-- extension. A stock Postgres without pgvector genuinely should not have it,
-- so its absence from a replay is the guard working rather than drift.
--
-- `learning_paths` exists in production and in the generated types, and no line
-- of app or edge-function code reads or writes it. Authoring a table on the
-- strength of a type definition alone would be inventing schema, and an unused
-- table is the one kind a rebuilt environment can do without. Left out
-- knowingly: if something starts querying it, `migrationReplay` will say so on
-- the first CI run after.
