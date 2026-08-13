-- Approve the seven Lisan-derived Yemeni rules.
--
-- 20260804120000 seeded them as status='draft' so a human decided whether they
-- were right before they shaped anything. dialectHelpers.fetchRules() selects
-- status='approved' only, so until now they have been inert: invisible to
-- reading-passage, generate-daily-story and every other generator. This is that
-- decision, taken and recorded so it persists across environments rather than
-- living as a one-off UPDATE in one database.
--
-- What changes the moment this lands, beyond the prompt text:
-- harvestForbiddenTokens() feeds examples.bad from APPROVED rules into the
-- MSA-leak detector, so seven new forbidden tokens appear for Yemeni --
-- أين، ماذا، ليست، انتم and the Egyptian negations مافيش، ماكانش، ماعنديش.
-- The other bad examples (الآن، الذي، التي، الذين، هؤلاء، ليس، لست، لماذا) were
-- already on UNIVERSAL_MSA_LEAKS and change nothing. None of the seven collide
-- with ALWAYS_ALLOWED.Yemeni; src/test/yemeniCorpusRules.test.ts fails if that
-- ever stops being true, because a rule arguing against a whitelisted form is
-- silently dropped and reads as policy that never applies.
--
-- Two of the seven are weaker than the rest and are approved knowingly, because
-- both concern forms already flagged by UNIVERSAL_MSA_LEAKS -- so the rule adds
-- a dialectal alternative where the model previously had a prohibition and no
-- replacement, which is strictly better than silence:
--   * the plural demonstrative (ذول/هذول 122 across variants vs هؤلاء 398)
--   * "now" (الحين 418، ذلحين 58 vs الآن 1,241), which also sits awkwardly
--     against the 2026-05 seeded vocabulary row leading with ذحين -- attested
--     just 9 times in this corpus. Worth a native speaker's eye; retire either
--     row rather than editing it, so the history stays legible.
--
-- Scoped on notes LIKE 'Lisan%' so a future mine-dialect-corpus run's drafts
-- are not swept along with them. Idempotent: the status predicate means a
-- re-run is a no-op.

UPDATE public.dialect_rules
SET status = 'approved',
    approved_at = now(),
    updated_at = now()
WHERE dialect = 'Yemeni'
  AND source = 'corpus_mined'
  AND status = 'draft'
  AND notes LIKE 'Lisan%';
