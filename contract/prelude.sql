-- Makes the 137 Supabase migrations applicable to a stock PostgreSQL server.
--
-- The migrations reference auth.uid() 233 times, auth.users, and storage
-- objects/buckets 91 times — all supplied by the Supabase platform rather than
-- by the migrations themselves. Recreating just enough of that surface lets the
-- whole set replay from scratch against `postgres:16`, which is far lighter in
-- CI than standing up the full Supabase stack and is all the schema-contract
-- check needs: it asks whether the app's tables and columns exist, not whether
-- RLS admits a particular caller.
--
-- Deliberately minimal. Anything beyond what the migrations touch would be a
-- second, unversioned definition of the platform, which is a thing to maintain
-- and get wrong.

-- ── Roles the migrations GRANT to ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO authenticator;

-- ── auth ─────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                text,
  encrypted_password   text,
  raw_user_meta_data   jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data    jsonb DEFAULT '{}'::jsonb,
  email_confirmed_at   timestamptz,
  last_sign_in_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id              text,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider        text,
  identity_data   jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, id)
);

-- The request's claims. On Supabase these come from the JWT via a GUC; the same
-- mechanism works here, so a test can impersonate a user by setting it.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', 'anon');
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT auth.jwt() ->> 'email';
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;

-- ── storage ──────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  owner              uuid,
  public             boolean DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        text REFERENCES storage.buckets(id),
  name             text,
  owner            uuid,
  metadata         jsonb,
  path_tokens      text[],
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now()
);

-- Used by the storage RLS policies the migrations create.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parts text[];
BEGIN
  parts := string_to_array(name, '/');
  RETURN parts[1:array_length(parts, 1) - 1];
END
$$;

CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parts text[];
BEGIN
  parts := string_to_array(name, '/');
  RETURN parts[array_length(parts, 1)];
END
$$;

CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parts text[];
BEGIN
  parts := string_to_array(storage.filename(name), '.');
  RETURN parts[array_length(parts, 1)];
END
$$;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects, storage.buckets TO service_role;

-- ── realtime ─────────────────────────────────────────────────────────────────
-- Migrations add tables to this publication; it must exist for that to work.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- ── extensions schema ────────────────────────────────────────────────────────
-- Some migrations qualify helper functions with `extensions.`.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- public is where everything the app touches lives.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
