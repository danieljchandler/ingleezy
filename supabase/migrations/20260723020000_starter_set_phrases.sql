-- Cold-start content: a small starter set of everyday phrases per dialect so
-- a brand-new user isn't greeted with an empty Set Phrases library on day one.
-- Inserted as status='draft' (the same status seed-set-phrases/index.ts uses
-- for AI-generated drafts) — these are NOT visible to learners
-- (RLS: "Anyone can view published phrases" requires status='published')
-- until an admin reviews and publishes them via the existing
-- /admin/set-phrases approval flow. Flagged for native-speaker review before
-- publishing.

INSERT INTO public.set_phrases
  (dialect, phrase_arabic, phrase_transliteration, phrase_english, reply_arabic, reply_transliteration, reply_english, formality, difficulty, status, tags)
VALUES
  -- Gulf (Khaliji)
  ('Gulf', 'شلونك؟', 'shlonak?', 'How are you?', 'زين، الحمدلله', 'zain, al-hamdulillah', 'Good, thank God', 'casual', 'A1', 'draft', ARRAY['starter','greeting']),
  ('Gulf', 'تسلم', 'tislam', 'Thank you / bless you', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','gratitude']),
  ('Gulf', 'خلها علي', 'khalha 3alay', 'Let it be on me / I''ll take care of it', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','hospitality']),
  ('Gulf', 'إن شاء الله بخير', 'in sha'' allah bi khair', 'God willing, all is well', NULL, NULL, NULL, 'neutral', 'A1', 'draft', ARRAY['starter','well-wish']),
  ('Gulf', 'ما عليه', 'ma 3alaih', 'No worries / it''s fine', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','reassurance']),
  ('Gulf', 'الله يعطيك العافية', 'Allah y3teek al-3afya', 'God give you strength (said to someone working)', 'الله يعافيك', 'Allah y3afeek', 'God grant you wellness too', 'neutral', 'A2', 'draft', ARRAY['starter','well-wish']),
  ('Gulf', 'بشوي بشوي', 'bshway bshway', 'Slowly, slowly / take it easy', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','encouragement']),
  ('Gulf', 'الله يبارك فيك', 'Allah ybarik feek', 'God bless you', NULL, NULL, NULL, 'neutral', 'A2', 'draft', ARRAY['starter','gratitude']),

  -- Egyptian (مصري)
  ('Egyptian', 'إزيك؟', 'ezzayak?', 'How are you?', 'الحمد لله كويس', 'el-hamdu lillah kwayes', 'Good, thank God', 'casual', 'A1', 'draft', ARRAY['starter','greeting']),
  ('Egyptian', 'متشكر', 'mutshakkir', 'Thanks / I''m grateful', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','gratitude']),
  ('Egyptian', 'على راسي', '3ala rasi', 'On my head (of course / gladly)', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','hospitality']),
  ('Egyptian', 'ولا يهمك', 'wala yihimmak', 'Don''t worry about it / no problem', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','reassurance']),
  ('Egyptian', 'ربنا يخليك', 'rabbena yikhallik', 'God preserve you', NULL, NULL, NULL, 'neutral', 'A2', 'draft', ARRAY['starter','well-wish']),
  ('Egyptian', 'بالراحة عليك', 'bir-raha 3alek', 'Take it easy / slow down', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','encouragement']),
  ('Egyptian', 'الله يعطيك العافية', 'Allah y3teek el-3afya', 'God give you strength (said to someone working)', 'الله يعافيك', 'Allah y3afeek', 'God grant you wellness too', 'neutral', 'A2', 'draft', ARRAY['starter','well-wish']),
  ('Egyptian', 'تسلم إيدك', 'tislam idak', 'Bless your hands (compliment on food/work)', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','gratitude']),

  -- Yemeni (يمني)
  ('Yemeni', 'كيفك؟', 'kayfak?', 'How are you?', 'زين، الحمدلله', 'zayn, al-hamdulillah', 'Good, thank God', 'casual', 'A1', 'draft', ARRAY['starter','greeting']),
  ('Yemeni', 'يعطيك العافية', 'y3teek al-3afya', 'God give you strength (said to someone working)', 'الله يعافيك', 'Allah y3afeek', 'God grant you wellness too', 'neutral', 'A2', 'draft', ARRAY['starter','well-wish']),
  ('Yemeni', 'ما عليك من شي', 'ma 3alaik min shay', 'Don''t worry about a thing', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','reassurance']),
  ('Yemeni', 'على عيني وراسي', '3ala 3aini wa rasi', 'On my eye and head (of course / gladly)', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','hospitality']),
  ('Yemeni', 'الله يبارك فيك', 'Allah yubarik feek', 'God bless you', NULL, NULL, NULL, 'neutral', 'A2', 'draft', ARRAY['starter','gratitude']),
  ('Yemeni', 'بالتؤدة', 'bit-ta''ada', 'Slowly / take your time', NULL, NULL, NULL, 'casual', 'A1', 'draft', ARRAY['starter','encouragement']),
  ('Yemeni', 'تسلم يدك', 'tislam yadak', 'Bless your hands (compliment on food/work)', NULL, NULL, NULL, 'casual', 'A2', 'draft', ARRAY['starter','gratitude']),
  ('Yemeni', 'إن شاء الله بخير', 'in sha'' allah bi khair', 'God willing, all is well', NULL, NULL, NULL, 'neutral', 'A1', 'draft', ARRAY['starter','well-wish']);
