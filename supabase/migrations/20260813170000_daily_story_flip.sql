-- Daily story direction flip: body_english is the story now (English, the
-- studied language); body_arabic holds its dialect scaffold translation and
-- may be absent if a generation's scaffold leg failed. The transliteration
-- column is retired — an Arabic speaker needs no romanization of Arabic —
-- but kept in place so old rows and the generated types stay valid.

ALTER TABLE public.daily_vocab_stories
  ALTER COLUMN body_arabic DROP NOT NULL;
