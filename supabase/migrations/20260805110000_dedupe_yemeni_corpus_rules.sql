-- Retire the duplicated copy of the seven Lisan-derived Yemeni rules.
--
-- 20260804120000 seeded them as drafts. 20260804134618 inserted the same seven
-- rows a second time, byte-identical in `rule` and `examples` (only the `notes`
-- prose differs), and 20260804150000 approves every Yemeni corpus_mined draft
-- whose notes are LIKE 'Lisan%' -- which is both copies. So the Yemeni rulebook
-- has been serving fourteen rows where seven were intended.
--
-- Why this is not merely untidy: every approved rule is rendered into the
-- system prompt of every Yemeni generator. renderPrompt() emits one bullet per
-- rule, so the model reads the same instruction twice; and renderFewShot()
-- takes only the SIX highest-priority rules that carry examples, so the
-- duplicates displaced real content. The ✅/❌ block that reading-passage and
-- generate-daily-story see went from covering interrogatives, negation,
-- relative pronouns, cultural references and sample phrases to covering the
-- first three of those, each stated twice. Half the few-shot budget was spent
-- repeating itself.
--
-- Retired rather than deleted: `status` already has a 'retired' value,
-- fetchRules() selects 'approved' only, and a soft retire keeps the row visible
-- in the Dialect Rulebook UI so the duplication stays legible instead of
-- vanishing. dialect_rule_violations.rule_id references these rows ON DELETE
-- SET NULL, so deleting would also quietly orphan any violation logged against
-- the duplicate.
--
-- Keeps the OLDEST row per (category, rule) -- the 20260804120000 copy, whose
-- notes carry the fuller reviewer context. Idempotent: a re-run finds nothing
-- left in 'approved' to retire.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY dialect, category, rule
           ORDER BY created_at, id
         ) AS dup_rank
  FROM public.dialect_rules
  WHERE dialect = 'Yemeni'
    AND source = 'corpus_mined'
    AND status = 'approved'
    AND notes LIKE 'Lisan%'
)
UPDATE public.dialect_rules AS r
SET status = 'retired',
    updated_at = now(),
    notes = coalesce(r.notes, '') ||
            ' [retired 2026-08-05: duplicate insert of the same rule, see migration 20260805110000]'
FROM ranked
WHERE r.id = ranked.id
  AND ranked.dup_rank > 1;

-- Same treatment for any copy still sitting in 'draft', so a later approval
-- sweep cannot resurrect the duplication.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY dialect, category, rule
           ORDER BY created_at, id
         ) AS dup_rank
  FROM public.dialect_rules
  WHERE dialect = 'Yemeni'
    AND source = 'corpus_mined'
    AND status IN ('draft', 'approved')
    AND notes LIKE 'Lisan%'
)
UPDATE public.dialect_rules AS r
SET status = 'retired',
    updated_at = now()
FROM ranked
WHERE r.id = ranked.id
  AND ranked.dup_rank > 1
  AND r.status = 'draft';
