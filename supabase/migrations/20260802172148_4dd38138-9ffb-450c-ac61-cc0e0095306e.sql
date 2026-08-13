DO $$
DECLARE
  rec       record;
  survivor  uuid;
  merged    int := 0;
  rekeyed   int := 0;
BEGIN

CREATE TEMP TABLE _grammar_kw (priority int, category text, keyword text) ON COMMIT DROP;
INSERT INTO _grammar_kw (priority, category, keyword) VALUES
  (1, 'negation', 'negation'),
  (2, 'negation', 'negative'),
  (3, 'negation', 'negate'),
  (4, 'negation', 'negating'),
  (5, 'negation', 'نفي'),
  (6, 'negation', 'منفي'),
  (7, 'possessives', 'possessive'),
  (8, 'possessives', 'possession'),
  (9, 'possessives', 'possessed'),
  (10, 'possessives', 'genitive'),
  (11, 'possessives', 'idafa'),
  (12, 'possessives', 'idaafa'),
  (13, 'possessives', 'iḍāfa'),
  (14, 'possessives', 'اضافة'),
  (15, 'possessives', 'ملكية'),
  (16, 'questions', 'question'),
  (17, 'questions', 'questions'),
  (18, 'questions', 'interrogative'),
  (19, 'questions', 'asking'),
  (20, 'questions', 'wh word'),
  (21, 'questions', 'wh words'),
  (22, 'questions', 'سؤال'),
  (23, 'questions', 'اسئلة'),
  (24, 'questions', 'استفهام'),
  (25, 'pronouns', 'pronoun'),
  (26, 'pronouns', 'pronouns'),
  (27, 'pronouns', 'demonstrative'),
  (28, 'pronouns', 'demonstratives'),
  (29, 'pronouns', 'ضمير'),
  (30, 'pronouns', 'ضمائر'),
  (31, 'pronouns', 'اشارة'),
  (32, 'sentence-structure', 'sentence structure'),
  (33, 'sentence-structure', 'word order'),
  (34, 'sentence-structure', 'syntax'),
  (35, 'sentence-structure', 'nominal sentence'),
  (36, 'sentence-structure', 'verbal sentence'),
  (37, 'sentence-structure', 'clause'),
  (38, 'sentence-structure', 'بنية الجملة'),
  (39, 'sentence-structure', 'ترتيب'),
  (40, 'verb-conjugation', 'conjugation'),
  (41, 'verb-conjugation', 'conjugate'),
  (42, 'verb-conjugation', 'conjugating'),
  (43, 'verb-conjugation', 'verb'),
  (44, 'verb-conjugation', 'verbs'),
  (45, 'verb-conjugation', 'tense'),
  (46, 'verb-conjugation', 'past tense'),
  (47, 'verb-conjugation', 'present tense'),
  (48, 'verb-conjugation', 'future tense'),
  (49, 'verb-conjugation', 'imperative'),
  (50, 'verb-conjugation', 'imperfect'),
  (51, 'verb-conjugation', 'perfect'),
  (52, 'verb-conjugation', 'تصريف'),
  (53, 'verb-conjugation', 'فعل'),
  (54, 'verb-conjugation', 'افعال');

CREATE TEMP TABLE _grammar_canon ON COMMIT DROP AS
WITH normalised AS (
  SELECT
    c.id,
    c.dialect,
    c.key,
    c.display_english,
    c.created_at,
    btrim(regexp_replace(
      lower(regexp_replace(c.key, '[ً-ْٰ]', '', 'g')),
      '[^[:alnum:]؀-ۿ]+', ' ', 'g'
    )) AS n
  FROM public.curriculum_concepts c
  WHERE c.kind = 'grammar'
),
variants AS (
  SELECT
    *,
    regexp_replace(n, '(^| )ال([^ ]{2,})', '\1\2', 'g') AS n_match
  FROM normalised
)
SELECT
  v.id,
  v.dialect,
  v.key,
  v.display_english,
  v.created_at,
  COALESCE(
    (SELECT k.category
       FROM _grammar_kw k
      WHERE v.n_match ~ ('(^| )' || k.keyword || '( |$)')
      ORDER BY k.priority
      LIMIT 1),
    replace(v.n, ' ', '-')
  ) AS canonical
FROM variants v
WHERE v.n <> '';

FOR rec IN
  SELECT dialect, canonical, count(*) AS n
    FROM _grammar_canon
   GROUP BY dialect, canonical
LOOP
  SELECT id INTO survivor
    FROM _grammar_canon
   WHERE dialect = rec.dialect AND canonical = rec.canonical
   ORDER BY (key = canonical) DESC, created_at ASC, id ASC
   LIMIT 1;

  IF rec.n > 1 THEN
    DELETE FROM public.content_concept_links l
     WHERE l.concept_id IN (
             SELECT id FROM _grammar_canon
              WHERE dialect = rec.dialect AND canonical = rec.canonical AND id <> survivor
           )
       AND (
             EXISTS (
               SELECT 1 FROM public.content_concept_links s
                WHERE s.concept_id = survivor
                  AND s.content_type = l.content_type
                  AND s.content_id = l.content_id
                  AND s.role = l.role
             )
             OR EXISTS (
               SELECT 1 FROM public.content_concept_links o
                WHERE o.concept_id IN (
                        SELECT id FROM _grammar_canon
                         WHERE dialect = rec.dialect AND canonical = rec.canonical
                           AND id <> survivor
                      )
                  AND o.content_type = l.content_type
                  AND o.content_id = l.content_id
                  AND o.role = l.role
                  AND o.id < l.id
             )
           );

    UPDATE public.content_concept_links l
       SET concept_id = survivor
     WHERE l.concept_id IN (
             SELECT id FROM _grammar_canon
              WHERE dialect = rec.dialect AND canonical = rec.canonical AND id <> survivor
           );

    WITH losers AS (
      SELECT id FROM _grammar_canon
       WHERE dialect = rec.dialect AND canonical = rec.canonical AND id <> survivor
    ),
    folded AS (
      SELECT
        m.user_id,
        sum(m.exposures)  AS exposures,
        sum(m.correct)    AS correct,
        sum(m.incorrect)  AS incorrect,
        min(m.ease)       AS ease,
        max(m.last_seen_at) AS last_seen_at,
        min(m.next_due_at)  AS next_due_at,
        min(array_position(
          ARRAY['new','learning','familiar','strong','mastered']::text[],
          m.strength::text
        )) AS rung
      FROM public.user_concept_mastery m
      WHERE m.concept_id IN (SELECT id FROM losers) OR m.concept_id = survivor
      GROUP BY m.user_id
    )
    INSERT INTO public.user_concept_mastery
      (user_id, concept_id, exposures, correct, incorrect, ease, strength, last_seen_at, next_due_at)
    SELECT
      f.user_id, survivor, f.exposures, f.correct, f.incorrect, f.ease,
      (ARRAY['new','learning','familiar','strong','mastered'])[f.rung]::public.mastery_strength,
      f.last_seen_at, f.next_due_at
    FROM folded f
    ON CONFLICT (user_id, concept_id) DO UPDATE SET
      exposures    = EXCLUDED.exposures,
      correct      = EXCLUDED.correct,
      incorrect    = EXCLUDED.incorrect,
      ease         = EXCLUDED.ease,
      strength     = EXCLUDED.strength,
      last_seen_at = EXCLUDED.last_seen_at,
      next_due_at  = EXCLUDED.next_due_at;

    UPDATE public.curriculum_concepts c
       SET display_english = sub.gloss
      FROM (
        SELECT g.display_english AS gloss
          FROM _grammar_canon g
         WHERE g.dialect = rec.dialect AND g.canonical = rec.canonical
           AND g.id <> survivor AND g.display_english IS NOT NULL
         ORDER BY g.created_at ASC, g.id ASC
         LIMIT 1
      ) sub
     WHERE c.id = survivor AND c.display_english IS NULL;

    DELETE FROM public.curriculum_concepts
     WHERE id IN (
             SELECT id FROM _grammar_canon
              WHERE dialect = rec.dialect AND canonical = rec.canonical AND id <> survivor
           );
    merged := merged + rec.n - 1;
  END IF;

  UPDATE public.curriculum_concepts c
     SET key = rec.canonical,
         display_english = COALESCE(c.display_english, g.key)
    FROM _grammar_canon g
   WHERE c.id = survivor AND g.id = survivor AND c.key <> rec.canonical;
  IF FOUND THEN rekeyed := rekeyed + 1; END IF;
END LOOP;

RAISE NOTICE 'grammar concepts: % merged away, % re-keyed', merged, rekeyed;
END $$;