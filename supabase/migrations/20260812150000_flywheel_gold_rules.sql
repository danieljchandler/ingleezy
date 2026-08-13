-- Rules mined from the flywheel's gold corrections carry their own provenance
-- tag, so an admin reviewing drafts can see which candidates are grounded in
-- real native-speaker fixes rather than model introspection.
ALTER TABLE public.dialect_rules
  DROP CONSTRAINT IF EXISTS dialect_rules_source_check;
ALTER TABLE public.dialect_rules
  ADD CONSTRAINT dialect_rules_source_check
  CHECK (source IN ('manual', 'ai_generated', 'corpus_mined', 'flywheel_gold'));
