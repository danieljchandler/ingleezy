
CREATE TABLE public.saved_text_translations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  source_text TEXT NOT NULL,
  source_dialect TEXT,
  detected_dialect TEXT,
  sentences JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_text_translations TO authenticated;
GRANT ALL ON public.saved_text_translations TO service_role;

ALTER TABLE public.saved_text_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own saved translations"
  ON public.saved_text_translations FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own saved translations"
  ON public.saved_text_translations FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own saved translations"
  ON public.saved_text_translations FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own saved translations"
  ON public.saved_text_translations FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_saved_text_translations_user_created
  ON public.saved_text_translations (user_id, created_at DESC);

CREATE TRIGGER update_saved_text_translations_updated_at
  BEFORE UPDATE ON public.saved_text_translations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
