#!/usr/bin/env node
/**
 * Grow the dialect eval golden set from the flywheel's gold corrections —
 * the "eval growth" loop-back wire: every native-speaker fix is a labeled
 * test case, so the evals get harder as the product gets corrected.
 *
 * Reads recent gold rows from training_examples and prints CANDIDATE golden
 * rows (machine output = bad, human correction = good) as JSONL on stdout.
 * Candidates are NOT appended automatically: a human curates them into
 * supabase/functions/_test/eval/golden/<dialect>.jsonl, because the offline
 * CI test pins good/bad against the hardcoded leak detector and a correction
 * can be gold without the "bad" side containing a detectable token (e.g. a
 * word-choice fix). Curation is one read per row; the CI test then enforces
 * the invariants forever.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/seed-eval-from-flywheel.mjs [--dialect Gulf] [--limit 50] [--days 30]
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const dialect = opt("dialect");
const limit = Number(opt("limit")) || 50;
const days = Number(opt("days")) || 30;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let query = supabase
  .from("training_examples")
  .select("id, dialect, task_type, machine_output, human_output, source_function, created_at")
  .eq("tier", "gold")
  .gte("created_at", new Date(Date.now() - days * 86400_000).toISOString())
  .order("created_at", { ascending: false })
  .limit(limit);
if (dialect) query = query.eq("dialect", dialect);

const { data, error } = await query;
if (error) {
  console.error(`fetch failed: ${error.message}`);
  process.exit(1);
}

let n = 0;
for (const row of data ?? []) {
  n++;
  process.stdout.write(
    JSON.stringify({
      id: `fly-${row.id.slice(0, 8)}`,
      // The curator writes the prompt: golden rows are prompts to a model,
      // while a correction only records the before/after text.
      prompt: `TODO: write the situation that produces this line (${row.task_type} via ${row.source_function ?? "?"})`,
      good: row.human_output,
      bad: row.machine_output,
      note: `flywheel gold ${row.created_at.slice(0, 10)}; dialect ${row.dialect}`,
    }) + "\n",
  );
}
console.error(`${n} candidate rows. Curate into supabase/functions/_test/eval/golden/, then run the eval_golden test.`);
