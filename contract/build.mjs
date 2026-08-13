#!/usr/bin/env node
/**
 * Rebuilds the database from supabase/migrations/ against a stock PostgreSQL.
 *
 * Answers a question nothing else does: can this schema be recreated from what
 * is in the repo? A migration set that only works against the one database it
 * grew on is a disaster-recovery problem and a new-environment problem, and it
 * is invisible until someone tries.
 *
 * Applies contract/prelude.sql first, which supplies the auth and storage
 * objects the migrations reference but do not create (see that file). Each
 * migration runs in its own transaction, so one failure does not abort the
 * rest — the point is to report every problem in one pass.
 *
 * DESTRUCTIVE: drops and recreates the public, auth and storage schemas before
 * it starts. Point DATABASE_URL at a throwaway database and nothing else. The
 * reset is not optional — without it a second run reports every `CREATE TABLE`
 * as "already exists", which reads exactly like a migration that does not
 * replay, and the whole output becomes noise.
 *
 * Usage:
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres node contract/build.mjs
 *
 * Prints a JSON summary on stdout; exits non-zero only if it could not connect.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..");
const MIGRATIONS = join(REPO_ROOT, "supabase", "migrations");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}

/** Run a .sql file, returning its error output if it failed. */
function apply(file) {
  try {
    execFileSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return null;
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    const line = stderr.split("\n").find((l) => l.includes("ERROR:")) ?? stderr.trim();
    return line.replace(/^.*ERROR:\s*/, "");
  }
}

/** Run a statement, returning its error output if it failed. */
function exec(sql) {
  try {
    execFileSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return null;
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    const line = stderr.split("\n").find((l) => l.includes("ERROR:")) ?? stderr.trim();
    return line.replace(/^.*ERROR:\s*/, "");
  }
}

// Start from nothing, so the result is the same whether this is a fresh CI
// service container or the fourth run of the afternoon on a local server.
const resetError = exec(
  "DROP SCHEMA IF EXISTS public CASCADE; " +
    "DROP SCHEMA IF EXISTS auth CASCADE; " +
    "DROP SCHEMA IF EXISTS storage CASCADE; " +
    "CREATE SCHEMA public;",
);
if (resetError) {
  console.error(`could not reset the database: ${resetError}`);
  process.exit(2);
}

const preludeError = apply(join(here, "prelude.sql"));
if (preludeError) {
  console.error(`prelude.sql failed: ${preludeError}`);
  process.exit(2);
}

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const failures = [];

for (const file of files) {
  const error = apply(join(MIGRATIONS, file));
  if (error) failures.push({ file, error });
}

/** Tables that ended up in the database, for the contract check to compare against. */
const tables = execFileSync(
  "psql",
  [
    DATABASE_URL,
    "-tAc",
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  ],
  { encoding: "utf8" },
)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

console.log(JSON.stringify({ total: files.length, failures, tables }, null, 2));
