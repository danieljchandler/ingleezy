-- Today's Story is read one sentence to a card, the way Souq News is: a
-- ~200-word block of unvocalized-to-the-eye dialect is where a learner stops
-- reading. The page can split the stored paragraphs on punctuation, but it can
-- only attach a translation to a line when the English splits into the same
-- number of pieces — so the generator now emits the split itself, with a
-- transliteration, a natural English and a literal gloss per sentence.
--
-- Nullable: every story already in the table keeps working through the page's
-- splitting fallback.
ALTER TABLE public.daily_vocab_stories
  ADD COLUMN sentences jsonb;
