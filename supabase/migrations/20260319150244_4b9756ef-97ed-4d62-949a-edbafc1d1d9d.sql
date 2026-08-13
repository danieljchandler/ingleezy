
ALTER TABLE public.topics ADD COLUMN IF NOT EXISTS dialect_module text NOT NULL DEFAULT 'Gulf';
ALTER TABLE public.vocabulary_words ADD COLUMN IF NOT EXISTS dialect_module text NOT NULL DEFAULT 'Gulf';
CREATE INDEX IF NOT EXISTS idx_topics_dialect ON public.topics(dialect_module);
CREATE INDEX IF NOT EXISTS idx_vocab_dialect ON public.vocabulary_words(dialect_module);
