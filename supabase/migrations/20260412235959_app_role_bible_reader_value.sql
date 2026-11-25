-- Split out of 20260413000000_bible_reader_role.sql so the new enum value is
-- committed before anything uses it. `supabase db push` runs each migration
-- file in one transaction, and Postgres refuses a value added by ALTER TYPE
-- ... ADD VALUE in the same transaction ("unsafe use of new value"), so the
-- combined file failed on every fresh project.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'bible_reader';
