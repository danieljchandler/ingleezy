-- Retire the duplicated copy of the seven Lisan-derived Yemeni rules.
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

-- Same treatment for any copy still sitting in draft, so a later approval
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