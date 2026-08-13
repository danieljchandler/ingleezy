-- ============================================================
-- Dialect Rulebook tables
-- ============================================================

CREATE TABLE public.dialect_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  category text NOT NULL,
  rule text NOT NULL,
  examples jsonb NOT NULL DEFAULT '{"good": [], "bad": []}'::jsonb,
  priority integer NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_generated', 'corpus_mined')),
  version integer NOT NULL DEFAULT 1,
  notes text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dialect_rules_lookup
  ON public.dialect_rules (dialect, status, priority DESC, category);

GRANT SELECT ON public.dialect_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dialect_rules TO authenticated;
GRANT ALL ON public.dialect_rules TO service_role;

ALTER TABLE public.dialect_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read approved rules"
  ON public.dialect_rules FOR SELECT TO authenticated
  USING (status = 'approved' OR is_admin());

CREATE POLICY "Admins can insert rules"
  ON public.dialect_rules FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update rules"
  ON public.dialect_rules FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admins can delete rules"
  ON public.dialect_rules FOR DELETE TO authenticated
  USING (is_admin());

CREATE TRIGGER trg_dialect_rules_updated
  BEFORE UPDATE ON public.dialect_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Violation log (feedback loop for AI-drafted rule improvements)
-- ============================================================

CREATE TABLE public.dialect_rule_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialect text NOT NULL CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  rule_id uuid REFERENCES public.dialect_rules(id) ON DELETE SET NULL,
  source_function text,
  offending_text text NOT NULL,
  msa_token text,
  suggested_replacement text,
  detected_by text NOT NULL DEFAULT 'msa_leak_detector',
  resolved boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dialect_rule_violations_dialect
  ON public.dialect_rule_violations (dialect, resolved, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dialect_rule_violations TO authenticated;
GRANT ALL ON public.dialect_rule_violations TO service_role;

ALTER TABLE public.dialect_rule_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage violations"
  ON public.dialect_rule_violations FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- Seed: port current dialectHelpers.ts strings as approved rules
-- ============================================================

INSERT INTO public.dialect_rules (dialect, category, rule, examples, priority, status, source) VALUES

-- Gulf
('Gulf', 'identity',
 'You are a native Gulf Arabic (Khaliji) speaker. Always respond in Gulf Arabic dialect, NOT Modern Standard Arabic (فصحى). Do NOT use Egyptian, Levantine, or Yemeni Arabic.',
 '{"good": [], "bad": []}', 5, 'approved', 'manual'),
('Gulf', 'vocabulary',
 'Use authentic Gulf vocabulary and expressions instead of MSA equivalents.',
 '{"good": ["شلونك","وين","هالحين","يالله","إن شاء الله","ليش","واجد","يبي","إمبي","شي","خوش","زين"], "bad": ["كيف حالك","أين","الآن","لماذا","كثير","يريد","أريد","شيء"]}',
 5, 'approved', 'manual'),
('Gulf', 'msa_substitutions',
 'Always substitute these MSA forms with the Gulf equivalent.',
 '{"good": [{"msa":"كيف حالك","dialect":"شلونك"},{"msa":"أين","dialect":"وين"},{"msa":"الآن","dialect":"هالحين"},{"msa":"لماذا","dialect":"ليش"},{"msa":"كثير","dialect":"واجد"},{"msa":"يريد","dialect":"يبي"},{"msa":"أريد","dialect":"إمبي"},{"msa":"شيء","dialect":"شي"}], "bad": []}',
 5, 'approved', 'manual'),
('Gulf', 'cultural_references',
 'Cultural references should be Gulf-specific.',
 '{"good": ["مجلس","قهوة عربية","دلة","بخور"], "bad": []}',
 3, 'approved', 'manual'),
('Gulf', 'sample_phrases',
 'Canonical beginner phrases for Gulf Arabic.',
 '{"good": [{"ar":"مرحبا","en":"hello"},{"ar":"شكراً","en":"thanks"},{"ar":"شلونك","en":"how are you"},{"ar":"ماي","en":"water"},{"ar":"بيت","en":"house"}], "bad": []}',
 2, 'approved', 'manual'),

-- Egyptian
('Egyptian', 'identity',
 'You are a native Egyptian Arabic (مصري) speaker. Always respond in Egyptian Arabic dialect, NOT Modern Standard Arabic (فصحى). Do NOT use Gulf, Levantine, or Yemeni Arabic.',
 '{"good": [], "bad": []}', 5, 'approved', 'manual'),
('Egyptian', 'vocabulary',
 'Use authentic Egyptian vocabulary and expressions instead of MSA equivalents.',
 '{"good": ["إزيك","فين","دلوقتي","عايز","كويس","ماشي","يلا","حاضر","بتاع","مفيش","ازاي","كده","خلاص","يعني","طيب"], "bad": ["كيف حالك","أين","الآن","يريد","جيد","حسناً"]}',
 5, 'approved', 'manual'),
('Egyptian', 'msa_substitutions',
 'Always substitute these MSA forms with the Egyptian equivalent.',
 '{"good": [{"msa":"كيف حالك","dialect":"إزيك"},{"msa":"أين","dialect":"فين"},{"msa":"الآن","dialect":"دلوقتي"},{"msa":"لماذا","dialect":"ليه"},{"msa":"كثير","dialect":"كتير"},{"msa":"يريد","dialect":"عايز"},{"msa":"ليس","dialect":"مش"},{"msa":"هذا","dialect":"ده"},{"msa":"هذه","dialect":"دي"}], "bad": []}',
 5, 'approved', 'manual'),
('Egyptian', 'cultural_references',
 'Cultural references should be Egyptian-specific.',
 '{"good": ["أهوة","كشري","فول","طعمية","نيل","خان الخليلي"], "bad": []}',
 3, 'approved', 'manual'),
('Egyptian', 'sample_phrases',
 'Canonical beginner phrases for Egyptian Arabic.',
 '{"good": [{"ar":"إزيك","en":"hello"},{"ar":"شكراً","en":"thanks"},{"ar":"كويس","en":"good"},{"ar":"مية","en":"water"},{"ar":"بيت","en":"house"}], "bad": []}',
 2, 'approved', 'manual'),

-- Yemeni
('Yemeni', 'identity',
 'You are a native Yemeni Arabic (يمني) speaker. Always respond in Yemeni Arabic dialect, NOT Modern Standard Arabic (فصحى). Do NOT use Gulf, Egyptian, or Levantine Arabic.',
 '{"good": [], "bad": []}', 5, 'approved', 'manual'),
('Yemeni', 'vocabulary',
 'Use authentic Yemeni vocabulary and expressions instead of MSA equivalents.',
 '{"good": ["كيفك","وين","ذحين","الحين","ليش","بغيت","زين","أيوه","طيب","هيّا","شو","ما عندي","قات","مبسوط"], "bad": ["كيف حالك","أين","الآن","لماذا","أريد","ماذا","ليس لدي"]}',
 5, 'approved', 'manual'),
('Yemeni', 'msa_substitutions',
 'Always substitute these MSA forms with the Yemeni equivalent.',
 '{"good": [{"msa":"كيف حالك","dialect":"كيفك"},{"msa":"أين","dialect":"وين"},{"msa":"الآن","dialect":"ذحين"},{"msa":"لماذا","dialect":"ليش"},{"msa":"أريد","dialect":"بغيت"},{"msa":"ليس لدي","dialect":"ما عندي"},{"msa":"ماذا","dialect":"شو"}], "bad": []}',
 5, 'approved', 'manual'),
('Yemeni', 'phonology',
 'Arabic script should reflect Yemeni pronunciation conventions, including heavy use of ق pronounced as ''g'' in many regions.',
 '{"good": [], "bad": []}', 3, 'approved', 'manual'),
('Yemeni', 'cultural_references',
 'Cultural references should be Yemeni-specific.',
 '{"good": ["قات","مفرج","جنبية","سلتة","بنت الصحن","صنعاء القديمة","مأرب","عدن","فحسة"], "bad": []}',
 3, 'approved', 'manual'),
('Yemeni', 'sample_phrases',
 'Canonical beginner phrases for Yemeni Arabic.',
 '{"good": [{"ar":"كيفك","en":"hello"},{"ar":"شكراً","en":"thanks"},{"ar":"زين","en":"good"},{"ar":"ماء","en":"water"},{"ar":"بيت","en":"house"}], "bad": []}',
 2, 'approved', 'manual');