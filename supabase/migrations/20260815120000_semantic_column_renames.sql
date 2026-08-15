-- Rename the columns whose names contradict what the flip put in them.
--
-- Through the retarget the rule was: keep the Arabic-era column names, flip
-- only the content. That was the right call while features were moving — it
-- kept each flip to one concern and avoided a migration per pull request. The
-- debt it built up is this: a handful of columns now say one thing and hold
-- another, and the app has no real Supabase project linked yet, so this is the
-- cheapest this will ever be. Plain renames, no expand/contract, no backfill.
--
-- What is NOT renamed, deliberately:
--   * `word_arabic` / `word_english`, `question_arabic` / `question_english`,
--     `text_arabic` / `text_english` and friends. These name the LANGUAGE, and
--     the language in them is still correct — English in the English column,
--     the learner's dialect in the Arabic one. What flipped is which of the two
--     is the target and which is the scaffold, and that is a property of the
--     app, not of the column.
--   * `user_vocabulary.transliteration`. Written only from the Hakiya-bridged
--     Arabic-clip popover, so it really does hold a Latin transliteration of
--     an Arabic word. Contrast `user_phrases.transliteration` below, which
--     holds the opposite thing under the same name — which is exactly why one
--     of the two has to move.
--   * `picture_scene_hotspots.root` is not renamed either — it is dropped, at
--     the bottom of this file, along with the other columns the flip left with
--     nothing to hold.

-- ── learner_errors: the target is not always Arabic any more ────────────────
--
-- These hold what the learner was aiming for and what came out. Post-flip that
-- is usually ENGLISH — but not always: shadowing still scores Hakiya-bridged
-- Arabic clips, and `score-shadow-attempt` picks its recogniser per clip. So
-- the honest name is neither `_arabic` nor `_english`: the column holds text in
-- whichever language the practice surface was working in.
ALTER TABLE public.learner_errors RENAME COLUMN target_arabic TO target_text;
ALTER TABLE public.learner_errors RENAME COLUMN produced_arabic TO produced_text;

-- ── root → word_family ─────────────────────────────────────────────────────
--
-- `root` meant an Arabic triliteral root, a real generative thing: ك-ت-ب gives
-- كتب, كتاب, مكتب. English has no such generator; what it has is the word
-- family (act → action, active, actor, react). `enrich-word-roots` now derives
-- the latter, so the column name is the last thing still claiming the former.
ALTER TABLE public.user_vocabulary RENAME COLUMN root TO word_family;
ALTER TABLE public.vocabulary_words RENAME COLUMN root TO word_family;

-- ── authentic_story_lines.english_literal → literal_arabic ─────────────────
--
-- The most actively wrong name of the set: it holds the literal ARABIC gloss
-- in English word order — Arabic words, arranged the way the English builds a
-- sentence, so the learner can see the structure. A column called
-- `english_literal` holding Arabic is a trap for the next person to read it.
ALTER TABLE public.authentic_story_lines RENAME COLUMN english_literal TO literal_arabic;

-- The daily story keeps the same thing one table over, under a name built the
-- same wrong way round. Renamed alongside it so both literals answer to one
-- word rather than two.
ALTER TABLE public.daily_vocab_stories RENAME COLUMN body_english_literal TO body_literal_arabic;

-- ── user_phrases / set_phrases transliteration → phonetic_ar ───────────────
--
-- These do not hold a transliteration in the usual direction. They hold the
-- ENGLISH respelled in Arabic letters ("ثانك يو" for "thank you") so a learner
-- can say it aloud before they can decode the spelling. That is the mirror
-- image of `user_vocabulary.transliteration`, and leaving both under one name
-- means the same identifier means opposite things two tables apart.
ALTER TABLE public.user_phrases RENAME COLUMN transliteration TO phonetic_ar;
ALTER TABLE public.set_phrases RENAME COLUMN phrase_transliteration TO phrase_phonetic_ar;
ALTER TABLE public.set_phrases RENAME COLUMN reply_transliteration TO reply_phonetic_ar;

-- ── user_letter_progress → user_sound_progress ─────────────────────────────
--
-- The Alphabet Journey became the English Sounds journey: 28 stops through the
-- English sound system rather than the Arabic alphabet. `letter_code` holds a
-- sound code ('p', 'th_voiced', 'clusters'), which is not a letter and in
-- several cases is not one letter.
--
-- Postgres carries the policies, indexes and triggers across a table rename;
-- their own names are renamed here too so nothing is left calling this letters.
ALTER TABLE public.user_letter_progress RENAME TO user_sound_progress;
ALTER TABLE public.user_sound_progress RENAME COLUMN letter_code TO sound_code;

ALTER INDEX IF EXISTS idx_user_letter_progress_user RENAME TO idx_user_sound_progress_user;
ALTER TRIGGER update_user_letter_progress_updated_at ON public.user_sound_progress
  RENAME TO update_user_sound_progress_updated_at;

ALTER POLICY "Users view own letter progress" ON public.user_sound_progress
  RENAME TO "Users view own sound progress";
ALTER POLICY "Users insert own letter progress" ON public.user_sound_progress
  RENAME TO "Users insert own sound progress";
ALTER POLICY "Users update own letter progress" ON public.user_sound_progress
  RENAME TO "Users update own sound progress";
ALTER POLICY "Users delete own letter progress" ON public.user_sound_progress
  RENAME TO "Users delete own sound progress";

-- ── user_vocabulary uniqueness: a card's identity is its ENGLISH ────────────
--
-- Not a rename — a bug the rename pass surfaced. The constraint was
-- (user_id, word_arabic, dialect), which was right when the Arabic was the
-- word being learned. Post-flip the Arabic is the GLOSS, and distinct English
-- words routinely share one: "big" and "large" both gloss to كبير. The second
-- save was rejected as a duplicate of the first, silently, in the one flow
-- where a learner is actively collecting vocabulary.
ALTER TABLE public.user_vocabulary
  DROP CONSTRAINT IF EXISTS user_vocabulary_user_word_dialect_key;
ALTER TABLE public.user_vocabulary
  ADD CONSTRAINT user_vocabulary_user_word_dialect_key
  UNIQUE (user_id, word_english, dialect);

-- ── story_video_segments: JSONB keys, same problem ─────────────────────────
--
-- Not columns but the same misnaming, inside a jsonb array. `arabic_beat` is
-- the story beat quoted from the English text and `narration_arabic` is the
-- English that was narrated. Rewritten in place; no-ops on an empty table.
UPDATE public.authentic_stories
SET story_video_segments = (
  SELECT jsonb_agg(
    (segment - 'arabic_beat' - 'narration_arabic')
      || jsonb_strip_nulls(jsonb_build_object(
           'story_beat', segment -> 'arabic_beat',
           'narration_text', segment -> 'narration_arabic'
         ))
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(story_video_segments) WITH ORDINALITY AS t(segment, ordinality)
)
WHERE jsonb_typeof(story_video_segments) = 'array'
  AND jsonb_array_length(story_video_segments) > 0;

-- ── Drop what the flip left with nothing to hold ───────────────────────────
--
-- Vocalisation (tashkeel) is a reading aid for Arabic script, and the reading
-- library no longer renders Arabic script as its primary text. The Fusha
-- columns held the Arabic *source* an import used to start from; imports now
-- start from English. Nothing reads or writes any of these.
ALTER TABLE public.authentic_stories
  DROP COLUMN IF EXISTS body_fusha,
  DROP COLUMN IF EXISTS body_fusha_vocalized,
  DROP COLUMN IF EXISTS body_dialect_vocalized;

ALTER TABLE public.authentic_story_lines
  DROP COLUMN IF EXISTS arabic_vocalized,
  DROP COLUMN IF EXISTS dialect,
  DROP COLUMN IF EXISTS dialect_vocalized;

-- Romanization of Arabic, for a reader who reads Arabic. The generator has
-- written a hard null here since the flip and no surface renders it.
ALTER TABLE public.daily_vocab_stories
  DROP COLUMN IF EXISTS body_transliteration;

-- `picture_scene_hotspots.root` outlives the feature that wrote it — the
-- picture-scene surface was cut, and nothing reads or writes the table. Left
-- in place it would be the last column in the schema still called `root`,
-- which is enough to keep `schemaContract` accepting a stale `root` in any
-- query, on any table. That is not hypothetical: it is how a `root` in
-- MyWordsReview's select list survived this pass's own sweep.
ALTER TABLE public.picture_scene_hotspots
  DROP COLUMN IF EXISTS root;
