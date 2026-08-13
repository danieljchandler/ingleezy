-- ============================================================
-- L1-Interference Rulebook (the English-target mirror of dialect_rules)
--
-- Documents the specific, well-studied ways Arabic speakers' L1 shapes
-- their English: article drops, copula omission, /p/→/b/, cluster
-- epenthesis, preposition transfer, calques, resumptive pronouns.
--
-- Consumed by two sides of the Brain:
--   1. Generation — englishHelpers.ts renders approved rules into the
--      system prompt so drills/content deliberately target these patterns.
--   2. Grading — transferErrorDetector.ts harvests examples.bad as
--      detectable patterns in learner-produced English.
--
-- `dialect` is NULL for rules that apply to all Arabic speakers; set it to
-- scope a rule to speakers of one dialect (e.g. Egyptian /θ/→/s/).
-- `explanation_ar` is the Fusha explanation shown to learners; dialect
-- variants can be layered on later.
-- ============================================================

CREATE TABLE public.interference_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dialect text CHECK (dialect IN ('Gulf', 'Egyptian', 'Yemeni')),
  category text NOT NULL CHECK (category IN
    ('article', 'copula', 'phonology', 'preposition', 'calque',
     'word_order', 'morphology', 'spelling', 'register')),
  rule text NOT NULL,
  explanation_ar text,
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

CREATE INDEX idx_interference_rules_lookup
  ON public.interference_rules (status, priority DESC, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.interference_rules TO authenticated;
GRANT ALL ON public.interference_rules TO service_role;

ALTER TABLE public.interference_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read approved interference rules"
  ON public.interference_rules FOR SELECT TO authenticated
  USING (status = 'approved' OR is_admin());

CREATE POLICY "Admins can insert interference rules"
  ON public.interference_rules FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update interference rules"
  ON public.interference_rules FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Admins can delete interference rules"
  ON public.interference_rules FOR DELETE TO authenticated
  USING (is_admin());

CREATE TRIGGER trg_interference_rules_updated
  BEFORE UPDATE ON public.interference_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Seed: the documented core of Arabic→English transfer errors.
-- bad = Arabic-shaped English as learners actually produce it;
-- good = the natural form. Sources: standard contrastive-analysis
-- literature on Arabic L1 interference (see docs/ in repo).
-- ============================================================

INSERT INTO public.interference_rules
  (dialect, category, rule, explanation_ar, examples, priority, status, source) VALUES

(NULL, 'article',
 'Arabic has no indefinite article, so learners drop a/an. Every singular countable noun needs one.',
 'لا توجد أداة تنكير في العربية ("أنا طالب")، لكن الإنجليزية تتطلب a/an قبل الاسم المفرد المعدود: I am a student.',
 '{"bad": ["I am student", "She is teacher", "He works as engineer"], "good": ["I am a student", "She is a teacher", "He works as an engineer"]}',
 5, 'approved', 'manual'),

(NULL, 'article',
 'Arabic uses ال with generic and abstract nouns; English drops "the" for them.',
 'العربية تستخدم "ال" مع الأسماء المجردة والعامة ("الحياة جميلة")، أما الإنجليزية فتحذف the: Life is beautiful وليس The life is beautiful.',
 '{"bad": ["The life is beautiful", "I love the music", "The patience is important"], "good": ["Life is beautiful", "I love music", "Patience is important"]}',
 4, 'approved', 'manual'),

(NULL, 'copula',
 'Arabic nominal sentences have no present-tense "to be"; learners omit is/am/are.',
 'الجملة الاسمية في العربية لا تحتاج فعل كينونة في المضارع ("التقرير جاهز")، لكن الإنجليزية تتطلب is/am/are دائماً: The report is ready.',
 '{"bad": ["The report ready", "She happy", "Where the bathroom?"], "good": ["The report is ready", "She is happy", "Where is the bathroom?"]}',
 5, 'approved', 'manual'),

(NULL, 'phonology',
 'Arabic has no /p/; learners produce /b/ instead. Drill aspirated /p/ minimal pairs.',
 'صوت /p/ غير موجود في العربية فيُنطق /b/ بدلاً منه. تدرّب على الفرق: pen/Ben، pat/bat — أخرج نفَساً قوياً مع /p/.',
 '{"bad": ["beoble", "bicture", "barty", "bark the car"], "good": ["people", "picture", "party", "park the car"]}',
 5, 'approved', 'manual'),

(NULL, 'phonology',
 'Arabic syllable structure avoids initial consonant clusters; learners insert a helping vowel.',
 'العربية تتجنب التقاء الساكنين في بداية الكلمة، فيضيف المتعلم حركة مساعدة: "إسبورت" بدل sport. انطق العنقود الصوتي دون حركة زائدة.',
 '{"bad": ["isport", "sipring", "istreet"], "good": ["sport", "spring", "street"]}',
 4, 'approved', 'manual'),

(NULL, 'phonology',
 'Learners devoice /v/ to /f/ (Arabic has ف but no /v/).',
 'صوت /v/ غير موجود في معظم اللهجات العربية فيُنطق /f/. الفرق مهم: very/ferry، van/fan — /v/ مجهور بذبذبة الأوتار الصوتية.',
 '{"bad": ["fery good", "fillage", "haf to go"], "good": ["very good", "village", "have to go"]}',
 3, 'approved', 'manual'),

(NULL, 'preposition',
 'Arabic preposition choices transfer literally: married from (متزوج من), afraid from (خائف من), angry from.',
 'حروف الجر لا تُترجم حرفياً: "متزوج من" تصبح married TO، و"خائف من" تصبح afraid OF، و"غاضب من" تصبح angry WITH.',
 '{"bad": ["married from", "afraid from", "angry from him", "listen music"], "good": ["married to", "afraid of", "angry with him", "listen to music"]}',
 4, 'approved', 'manual'),

(NULL, 'calque',
 'Arabic idioms translated word-for-word produce unnatural English.',
 'التعابير لا تُترجم حرفياً: "افتح النور" هي turn on the light وليس open the light، و"اقفل التليفون" هي hang up وليس close the phone.',
 '{"bad": ["open the light", "close the light", "close the phone", "cut the street"], "good": ["turn on the light", "turn off the light", "hang up the phone", "cross the street"]}',
 4, 'approved', 'manual'),

(NULL, 'word_order',
 'Arabic adjectives follow the noun; English adjectives precede it.',
 'الصفة في العربية تأتي بعد الاسم ("سيارة كبيرة")، وفي الإنجليزية قبله: a big car وليس a car big.',
 '{"bad": ["a car big", "a house beautiful"], "good": ["a big car", "a beautiful house"]}',
 3, 'approved', 'manual'),

(NULL, 'morphology',
 'Third-person singular -s is dropped (Arabic marks person on the verb differently).',
 'لا تنسَ إضافة -s للفعل مع الغائب المفرد في المضارع البسيط: he goes، she likes، it works.',
 '{"bad": ["he go", "she like", "it work"], "good": ["he goes", "she likes", "it works"]}',
 4, 'approved', 'manual'),

(NULL, 'morphology',
 'Arabic relative clauses keep a resumptive pronoun (اللي شفته); English drops it.',
 'في العربية نقول "الكتاب اللي قرأته"، لكن الإنجليزية تحذف الضمير العائد: the book which I read وليس which I read it.',
 '{"bad": ["the book which I read it", "the man who I saw him"], "good": ["the book which I read", "the man who I saw"]}',
 3, 'approved', 'manual'),

(NULL, 'spelling',
 'The /p/-/b/ confusion carries into spelling.',
 'الخلط بين p وb يظهر في الكتابة أيضاً: problem وليس broblem. راجع كل كلمة فيها p أو b.',
 '{"bad": ["broblem", "bicnic", "beper"], "good": ["problem", "picnic", "pepper"]}',
 3, 'approved', 'manual');
