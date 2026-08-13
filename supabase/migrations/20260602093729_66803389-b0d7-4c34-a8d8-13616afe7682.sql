-- Add Anki import fields to user_vocabulary
ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS tags text[],
  ADD COLUMN IF NOT EXISTS phonetic text,
  ADD COLUMN IF NOT EXISTS anki_note_id bigint,
  ADD COLUMN IF NOT EXISTS anki_card_id bigint,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_user_vocabulary_import_batch
  ON public.user_vocabulary(import_batch_id);

-- Track each Anki import for undo/audit
CREATE TABLE IF NOT EXISTS public.anki_import_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  dialect text NOT NULL,
  source_filename text,
  total_cards integer NOT NULL DEFAULT 0,
  imported_cards integer NOT NULL DEFAULT 0,
  skipped_duplicates integer NOT NULL DEFAULT 0,
  media_uploaded integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.anki_import_batches TO authenticated;
GRANT ALL ON public.anki_import_batches TO service_role;

ALTER TABLE public.anki_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own anki batches"
  ON public.anki_import_batches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own anki batches"
  ON public.anki_import_batches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own anki batches"
  ON public.anki_import_batches FOR DELETE
  USING (auth.uid() = user_id);
