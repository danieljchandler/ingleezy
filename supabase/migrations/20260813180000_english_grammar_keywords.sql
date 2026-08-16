-- English retarget: extend the grammar-concept taxonomy with the two
-- highest-frequency Arabic-speaker error areas — articles and prepositions —
-- and re-run the keyword-based re-keying so any free-text grammar points
-- mentioning them land on the new rungs.
--
-- The keyword table mirrors CATEGORY_KEYWORDS in grammarTaxonomy.ts exactly
-- (pinned by src/test/grammarTaxonomy.test.ts against THIS migration, which
-- supersedes the copy in 20260801150000). Adding keys is safe: a new key is a
-- fresh mastery rung; renaming one is what orphans recorded mastery.
--
-- The keywords ride in a CTE rather than a temp table. `CREATE TEMP TABLE ...
-- ON COMMIT DROP` only survives to the next statement when something wraps the
-- file in a transaction: the Supabase CLI does, plain `psql -f` does not, and
-- under the latter the table was dropped the instant it was committed and the
-- INSERT that followed failed on a relation that no longer existed. A CTE is
-- one statement, so it needs nothing from the runner.

WITH _grammar_kw (priority, category, keyword) AS (
  VALUES
  (1, 'articles', 'article'),
  (2, 'articles', 'articles'),
  (3, 'articles', 'a/an'),
  (4, 'articles', 'definite article'),
  (5, 'articles', 'indefinite article'),
  (6, 'articles', 'أداة التعريف'),
  (7, 'articles', 'أداة تنكير'),
  (8, 'articles', 'ادوات التعريف'),
  (9, 'prepositions', 'preposition'),
  (10, 'prepositions', 'prepositions'),
  (11, 'prepositions', 'حرف جر'),
  (12, 'prepositions', 'حروف الجر'),
  (13, 'prepositions', 'حروف جر'),
  (14, 'negation', 'negation'),
  (15, 'negation', 'negative'),
  (16, 'negation', 'negate'),
  (17, 'negation', 'negating'),
  (18, 'negation', 'نفي'),
  (19, 'negation', 'منفي'),
  (20, 'possessives', 'possessive'),
  (21, 'possessives', 'possession'),
  (22, 'possessives', 'possessed'),
  (23, 'possessives', 'genitive'),
  (24, 'possessives', 'idafa'),
  (25, 'possessives', 'idaafa'),
  (26, 'possessives', 'iḍāfa'),
  (27, 'possessives', 'اضافة'),
  (28, 'possessives', 'ملكية'),
  (29, 'questions', 'question'),
  (30, 'questions', 'questions'),
  (31, 'questions', 'interrogative'),
  (32, 'questions', 'asking'),
  (33, 'questions', 'wh word'),
  (34, 'questions', 'wh words'),
  (35, 'questions', 'سؤال'),
  (36, 'questions', 'اسئلة'),
  (37, 'questions', 'استفهام'),
  (38, 'pronouns', 'pronoun'),
  (39, 'pronouns', 'pronouns'),
  (40, 'pronouns', 'demonstrative'),
  (41, 'pronouns', 'demonstratives'),
  (42, 'pronouns', 'ضمير'),
  (43, 'pronouns', 'ضمائر'),
  (44, 'pronouns', 'اشارة'),
  (45, 'sentence-structure', 'sentence structure'),
  (46, 'sentence-structure', 'word order'),
  (47, 'sentence-structure', 'syntax'),
  (48, 'sentence-structure', 'nominal sentence'),
  (49, 'sentence-structure', 'verbal sentence'),
  (50, 'sentence-structure', 'clause'),
  (51, 'sentence-structure', 'بنية الجملة'),
  (52, 'sentence-structure', 'ترتيب'),
  (53, 'verb-conjugation', 'conjugation'),
  (54, 'verb-conjugation', 'conjugate'),
  (55, 'verb-conjugation', 'conjugating'),
  (56, 'verb-conjugation', 'verb'),
  (57, 'verb-conjugation', 'verbs'),
  (58, 'verb-conjugation', 'tense'),
  (59, 'verb-conjugation', 'past tense'),
  (60, 'verb-conjugation', 'present tense'),
  (61, 'verb-conjugation', 'future tense'),
  (62, 'verb-conjugation', 'imperative'),
  (63, 'verb-conjugation', 'imperfect'),
  (64, 'verb-conjugation', 'perfect'),
  (65, 'verb-conjugation', 'تصريف'),
  (66, 'verb-conjugation', 'فعل'),
  (67, 'verb-conjugation', 'افعال')
)
-- Re-key free-text grammar concepts that match the new categories' keywords
-- (same normalization approach as 20260801150000: lowercase, trimmed).
UPDATE public.curriculum_concepts c
SET key = kw.category
FROM (
  SELECT DISTINCT ON (c2.id) c2.id, k.category
  FROM public.curriculum_concepts c2
  JOIN _grammar_kw k
    ON position(k.keyword IN lower(c2.key)) > 0
  WHERE c2.kind = 'grammar'
    AND c2.key NOT IN (SELECT DISTINCT category FROM _grammar_kw)
    AND k.category IN ('articles', 'prepositions')
  ORDER BY c2.id, k.priority
) kw
WHERE c.id = kw.id;
