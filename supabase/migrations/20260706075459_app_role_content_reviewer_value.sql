-- Split out of 20260706075500_complete_rbac_roles.sql for the same reason as
-- 20260412235959_app_role_bible_reader_value.sql: an enum value added inside a
-- migration's transaction cannot be used until that transaction commits.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'content_reviewer';
