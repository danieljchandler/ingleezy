-- Yemeni dialect rules proposed from the Lisan corpus.
--
-- Until now the only grounded writer into dialect_rules was
-- mine-dialect-corpus, which samples our own published content. For Yemeni
-- that content is almost entirely AI-generated, so the rulebook feeding every
-- generator was a closed loop with no external input. These rows are the first
-- Yemeni rules backed by attested speech: ~801k tokens of annotated Yemeni
-- (docs/yemeni/lexicon-full.json, affix-inventory.json), CC BY 4.0.
--
-- Everything lands as status='draft', so nothing reaches a generator until an
-- admin approves it in the Dialect Rulebook UI. dialectHelpers.fetchRules only
-- selects status='approved'. Counts are in `notes` so the reviewer can weigh
-- each rule rather than take it on faith.
--
-- Candidates come from scripts/derive-yemeni-rule-candidates.py, then curated.
-- Two deliberate omissions:
--   * No rule against هذا/هذه. The corpus has هذا outnumbering ذا 17:1 and هذه
--     outnumbering ذي 8:1, which is why both were just whitelisted in
--     msaLeakDetector. A rule telling generators to avoid them would contradict
--     that, and harvestForbiddenTokens would drop it anyway.
--   * Nothing sourced from فين/دي/ده/ايه. They are common in this corpus but
--     they are Egyptian, borrowed through media; DIALECT_EXTRA.Yemeni exists to
--     catch exactly that drift.

INSERT INTO public.dialect_rules
  (dialect, category, rule, examples, priority, status, source, notes)
VALUES

-- Interrogatives. أين/لماذا/ماذا are already on the seeded vocabulary row's bad
-- list; this restates them as explicit pairs with attested counts.
('Yemeni', 'msa_substitutions',
 'Use the Yemeni interrogative, never the MSA one: وين for "where", ليش for "why", أيش for "what", منو for "who".',
 '{"good": [{"msa":"أين","dialect":"وين"},{"msa":"لماذا","dialect":"ليش"},{"msa":"ماذا","dialect":"أيش"},{"msa":"من هو","dialect":"منو"}], "bad": ["أين","لماذا","ماذا"]}',
 5, 'draft', 'corpus_mined',
 'Lisan counts: وين 316, ليش 775, أيش 1067, منو 45. فين (428) is commoner still but is Egyptian, borrowed through media — excluded deliberately.'),

-- Negation. The corpus does not settle مش vs مو, so the rule names both rather
-- than inventing a preference; generate-listen-script's YEMENI_FLAVOR currently
-- prefers ما هوش, which the counts do not support as the dominant form.
('Yemeni', 'msa_substitutions',
 'Never negate with ليس. Yemeni uses مش or مو, or ما + pronoun (ما هو / ما هي).',
 '{"good": [{"msa":"ليس","dialect":"مش"},{"msa":"ليس","dialect":"مو"},{"msa":"ليس هو","dialect":"ما هو"}], "bad": ["ليس","ليست","لست"]}',
 5, 'draft', 'corpus_mined',
 'Lisan counts: مش 1326, مو 665, ما هو 221, ما هي 38, vs ليس 732. مش outranks مو 2:1; both are in real use, so the rule does not pick between them.'),

-- Relative pronoun. The clearest single result in the corpus.
('Yemeni', 'msa_substitutions',
 'Use اللي as the relative pronoun for every gender and number. Never الذي / التي / الذين.',
 '{"good": [{"msa":"الذي","dialect":"اللي"},{"msa":"التي","dialect":"اللي"},{"msa":"الذين","dialect":"اللي"}], "bad": ["الذي","التي","الذين"]}',
 5, 'draft', 'corpus_mined',
 'Lisan counts: اللي 4406 vs الذي 2259, التي 1058, الذين 417 — the dialectal form outnumbers all three MSA forms combined.'),

-- Plural demonstrative. Distinct from هذا/هذه, which stay acceptable.
('Yemeni', 'msa_substitutions',
 'For the plural demonstrative use ذول / هذول, not هؤلاء.',
 '{"good": [{"msa":"هؤلاء","dialect":"ذول"},{"msa":"هؤلاء","dialect":"هذول"}], "bad": ["هؤلاء"]}',
 3, 'draft', 'corpus_mined',
 'Lisan counts: هذول 50, ذول 21, ذولا 25, هولا 26 — 122 across variants vs هؤلاء 398. Lower confidence than the rules above; the MSA form still leads.'),

-- "Now". Worth reviewing against the seeded vocabulary row, which leads on ذحين.
('Yemeni', 'msa_substitutions',
 'Say الحين or ذلحين for "now", not الآن.',
 '{"good": [{"msa":"الآن","dialect":"الحين"},{"msa":"الآن","dialect":"ذلحين"}], "bad": ["الآن"]}',
 4, 'draft', 'corpus_mined',
 'Lisan counts: الحين 418, ذلحين 58, ذحين 9. The seeded vocabulary rule leads with ذحين, which this corpus barely attests — worth a native-speaker check rather than an automatic edit, since the corpus is written Twitter and may under-represent it.'),

-- Second person plural.
('Yemeni', 'pronoun',
 'The second person masculine plural is انتو (also انتوا), not انتم.',
 '{"good": [{"msa":"انتم","dialect":"انتو"}], "bad": ["انتم"]}',
 3, 'draft', 'corpus_mined',
 'Lisan counts: انتو 361, انتوا 63, vs انتم as lemma.'),

-- Grammar, from the affix inventory rather than the lexicon. This is the one
-- rule here that is syntactic rather than lexical, and it corroborates a claim
-- that until now lived only as a hard-coded string in generate-listen-script.
('Yemeni', 'negation',
 'Negate with ما before the verb. Do NOT use the Egyptian/Levantine ما...ش circumfix.',
 '{"good": ["ما عاد", "ما يحلو", "ما حسبنا"], "bad": ["مافيش","ماكانش","ماعنديش"]}',
 4, 'draft', 'corpus_mined',
 'Lisan affix inventory: bare ما negation prefix 5089 occurrences vs 131 for the ما...ش circumfix across all variants — a 39:1 ratio. Independently confirms the hand-written claim in generate-listen-script YEMENI_FLAVOR.');
