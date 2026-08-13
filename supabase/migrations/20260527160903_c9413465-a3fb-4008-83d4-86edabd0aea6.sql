
-- MSA Bridge: Phase 1 foundational schema

-- 1. Profile flags for MSA background + Bridge view toggle
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS msa_background text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS bridge_view_enabled boolean NOT NULL DEFAULT false;

-- 2. MSA pivot fields on vocabulary tables (additive, nullable)
ALTER TABLE public.vocabulary_words
  ADD COLUMN IF NOT EXISTS msa_form text,
  ADD COLUMN IF NOT EXISTS msa_note text;

ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS msa_form text,
  ADD COLUMN IF NOT EXISTS msa_note text;

-- 3. Transformation rules table (MSA -> Dialect sound/grammar shifts)
CREATE TABLE IF NOT EXISTS public.msa_transformation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialect text NOT NULL DEFAULT 'Gulf',
  category text NOT NULL DEFAULT 'sound_shift',
  rule_name text NOT NULL,
  msa_pattern text NOT NULL,
  dialect_pattern text NOT NULL,
  example_msa text,
  example_dialect text,
  example_audio_url text,
  notes text,
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.msa_transformation_rules TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.msa_transformation_rules TO authenticated;
GRANT ALL ON public.msa_transformation_rules TO service_role;

ALTER TABLE public.msa_transformation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published rules"
  ON public.msa_transformation_rules
  FOR SELECT
  USING (status = 'published' OR is_admin());

CREATE POLICY "Admins manage rules"
  ON public.msa_transformation_rules
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE TRIGGER update_msa_transformation_rules_updated_at
  BEFORE UPDATE ON public.msa_transformation_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_msa_rules_dialect ON public.msa_transformation_rules(dialect, display_order);

-- 4. Seed Gulf sound-shift + pronoun + verb-prefix rules (pilot)
INSERT INTO public.msa_transformation_rules
  (dialect, category, rule_name, msa_pattern, dialect_pattern, example_msa, example_dialect, notes, display_order)
VALUES
  ('Gulf', 'sound_shift', 'Qaf becomes G',          'ق', 'g', 'قَلْب',   'galb',   'The MSA ق often softens to a hard "g" in Gulf dialect.', 10),
  ('Gulf', 'sound_shift', 'Kaf becomes Ch',         'ك', 'ch','كَيْف',   'chayf',  'Before front vowels, ك often becomes "ch" (especially feminine 2nd person).', 20),
  ('Gulf', 'sound_shift', 'Jim stays as Y in some words', 'ج', 'y',  'جَديد',   'yadeed', 'In some Gulf sub-dialects (esp. Emirati) ج becomes "y".', 30),
  ('Gulf', 'sound_shift', 'Thaa becomes Taa/Saa',   'ث', 't / s','ثَلاثة', 'talata', 'ث usually merges with ت (or س in loans).', 40),
  ('Gulf', 'sound_shift', 'Dhal becomes Dal',       'ذ', 'd', 'هَذا',    'hada',   'ذ commonly merges with د.', 50),
  ('Gulf', 'pronoun',    'You (m. sg.)',           'أَنْتَ', 'إنت', 'أَنْتَ هُنا', 'إنت هني', 'Drop case ending, simplify hamza.', 100),
  ('Gulf', 'pronoun',    'You (f. sg.)',           'أَنْتِ', 'إنتي', 'أَنْتِ جَميلة', 'إنتي حلوة', 'Add final ي for feminine.', 110),
  ('Gulf', 'pronoun',    'We',                     'نَحْنُ', 'إحنا', 'نَحْنُ هُنا', 'إحنا هني', 'Common across all Arabic dialects.', 120),
  ('Gulf', 'verb_prefix','Future marker',          'سَـ / سَوْفَ', 'بـ / راح', 'سَأَذْهَب', 'بأروح / راح أروح', 'Future is marked by بـ prefix or راح + verb.', 200),
  ('Gulf', 'verb_prefix','Present continuous',     'يَفْعَل', 'يـ (no bi-)', 'يَكْتُب', 'يكتب', 'Gulf does NOT use the Egyptian بـ for present continuous.', 210),
  ('Gulf', 'vocab_swap', 'What?',                  'ماذا', 'شو / وش', 'ماذا تُريد؟', 'شو تبغى؟', 'Question word is completely replaced.', 300),
  ('Gulf', 'vocab_swap', 'Now',                    'الآن', 'دَحين / الحين', 'الآن', 'دَحين', 'Time adverb swap.', 310),
  ('Gulf', 'vocab_swap', 'I want',                 'أُريد', 'أَبغى / أبا', 'أُريد ماء', 'أبغى ماي', 'Common verb swap; ماء also becomes ماي.', 320),
  ('Gulf', 'vocab_swap', 'A lot / very',           'كَثيراً / جِدّاً', 'وايد', 'شُكراً جَزيلاً', 'مَشكور وايد', 'Intensifier swap.', 330)
ON CONFLICT DO NOTHING;
