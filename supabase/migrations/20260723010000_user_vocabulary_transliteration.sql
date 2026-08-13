-- user_vocabulary (the personal SRS deck powering MyWordsReview/QuizCard, the
-- app's most-used learning surface) had no transliteration column, unlike
-- vocabulary_words and user_phrases which already carry one. This left the
-- core flashcard/quiz loop as the only major surface with no transliteration.
ALTER TABLE public.user_vocabulary
  ADD COLUMN transliteration text;
