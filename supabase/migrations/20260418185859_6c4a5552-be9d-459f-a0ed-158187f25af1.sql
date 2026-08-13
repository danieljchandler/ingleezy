
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS placement_level_gulf TEXT,
  ADD COLUMN IF NOT EXISTS placement_level_egyptian TEXT,
  ADD COLUMN IF NOT EXISTS placement_level_yemeni TEXT,
  ADD COLUMN IF NOT EXISTS placement_taken_at_gulf TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS placement_taken_at_egyptian TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS placement_taken_at_yemeni TIMESTAMPTZ;

-- Backfill: copy existing placement_level into Gulf slot if empty (legacy data was Gulf-only)
UPDATE public.profiles
SET placement_level_gulf = placement_level,
    placement_taken_at_gulf = placement_taken_at
WHERE placement_level IS NOT NULL AND placement_level_gulf IS NULL;
