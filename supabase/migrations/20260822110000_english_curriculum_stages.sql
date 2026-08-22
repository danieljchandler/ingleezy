-- The six curriculum stages still described the Arabic app. Seeded in
-- 20260224000000 from the Lahja (Gulf Arabic) curriculum document — "Read
-- Arabic script, produce Gulf sounds", "Follow authentic Gulf content" — and
-- never re-aimed when the app flipped to teaching English. A learner opening
-- /curriculum read a journey through the language they already speak.
--
-- Names and Arabic names stay (Foundations/الأسس … are journey-neutral); the
-- descriptions now describe the English journey, milestones matched to what
-- the app actually teaches at each band (the Sounds journey at the bottom,
-- authentic media in the middle, register at the top). Keyed on stage_number,
-- which the seed fixed and nothing renumbers.
UPDATE public.curriculum_stages SET description =
  'Master the English sounds Arabic lacks (/p/, /v/, clusters), spell what you hear, use 50+ survival phrases. Duration: 4–6 weeks (15–20 min/day).'
  WHERE stage_number = 1;
UPDATE public.curriculum_stages SET description =
  'Construct basic sentences with articles and "to be", understand slow clear English, 500+ word vocabulary. Duration: 8–12 weeks (20–30 min/day).'
  WHERE stage_number = 2;
UPDATE public.curriculum_stages SET description =
  'Follow real English videos with Arabic scaffolding, converse on familiar topics, 1,500+ words. Duration: 8–16 weeks (25–40 min/day).'
  WHERE stage_number = 3;
UPDATE public.curriculum_stages SET description =
  'Primary learning through authentic English media, express opinions, 3,000+ words. Duration: 12–20 weeks (30–45 min/day).'
  WHERE stage_number = 4;
UPDATE public.curriculum_stages SET description =
  'Follow fast conversation, understand connected speech and slang, 5,000+ words. Duration: 16–24 weeks (30–60 min/day).'
  WHERE stage_number = 5;
UPDATE public.curriculum_stages SET description =
  'Near-native comprehension, cultural fluency, shifting between casual and formal English registers. Ongoing.'
  WHERE stage_number = 6;
