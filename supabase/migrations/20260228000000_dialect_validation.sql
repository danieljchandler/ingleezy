-- Add dialect_validation column to saved_transcriptions.
-- Stores the raw Fanar-Sadiq Gulf Arabic dialect review for each transcription.
-- Nullable: null means Fanar was unavailable or timed out during processing.
-- Content may be plain Arabic/English text or JSON — stored as-is.
ALTER TABLE public.saved_transcriptions
  ADD COLUMN IF NOT EXISTS dialect_validation JSONB;
