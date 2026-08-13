#!/usr/bin/env node
/**
 * Export the training-data flywheel's corrections as versioned JSONL.
 *
 * Reads `training_examples` with the service role and writes one JSONL file
 * per (task_type, dialect) into ./training-exports/<date>/, plus:
 *
 *   - manifest.txt   — every distinct audio object the rows reference
 *                      (bucket/path), for bulk download. Audio is exported as
 *                      references + millisecond offsets, never sliced copies:
 *                      storage stays single-copy and training pipelines slice
 *                      cheaply.
 *   - summary.json   — row counts by task/dialect/tier, and the batch id.
 *
 * Each run stamps the exported rows with a fresh export_batch_id, so the
 * default incremental mode ("everything not yet exported") is one indexed
 * query, and any past dataset can be reconstructed exactly by batch id.
 *
 * ASR rows use a HuggingFace-datasets-friendly shape:
 *   {"audio": "video-audio/<id>.mp3", "start_ms": 41200, "end_ms": 44700,
 *    "text": "<human>", "machine_text": "<machine>", "dialect": "Yemeni",
 *    "tier": "gold", "engines": [...], "id": "..."}
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/export-training-data.mjs [options]
 *
 * Options:
 *   --tier-floor gold|silver|bronze   lowest tier to include (default silver)
 *   --task asr|translation|generation|diacritization|pronunciation|dialect_id
 *   --dialect Gulf|Egyptian|Yemeni
 *   --all                             include already-exported rows too
 *   --dry-run                         report what would export, write nothing,
 *                                     stamp nothing
 *   --upload                          also copy the files into the private
 *                                     training-exports storage bucket
 *
 * A pilot-friendly default: PII review is respected — rows from conversation
 * sources with pii_reviewed=false are excluded unless --include-unreviewed-pii
 * is passed (transcript and review rows are not conversation-derived and are
 * unaffected).
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

const TIER_ORDER = ["bronze", "silver", "gold"];
const tierFloor = opt("tier-floor") ?? "silver";
if (!TIER_ORDER.includes(tierFloor)) {
  console.error(`--tier-floor must be one of ${TIER_ORDER.join("|")}`);
  process.exit(2);
}
const includedTiers = TIER_ORDER.slice(TIER_ORDER.indexOf(tierFloor));
const taskFilter = opt("task");
const dialectFilter = opt("dialect");
const includeExported = flag("all");
const dryRun = flag("dry-run");
const upload = flag("upload");
const includeUnreviewedPii = flag("include-unreviewed-pii");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Sources whose text may quote a learner's conversation. */
const CONVERSATION_SOURCES = new Set(["assistant-chat", "free-chat", "conversation-practice"]);

const PAGE = 1000;

async function fetchRows() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("training_examples")
      .select("*")
      .in("tier", includedTiers)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!includeExported) query = query.is("export_batch_id", null);
    if (taskFilter) query = query.eq("task_type", taskFilter);
    if (dialectFilter) query = query.eq("dialect", dialectFilter);

    const { data, error } = await query;
    if (error) throw new Error(`fetch failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

function toRecord(row) {
  const base = {
    id: row.id,
    dialect: row.dialect,
    tier: row.tier,
    text: row.human_output,
    machine_text: row.machine_output,
    source: row.source_table,
    source_function: row.source_function,
    corrector_role: row.corrector_role,
    license: row.source_license,
    created_at: row.created_at,
  };
  if (row.audio_path) {
    return {
      audio: `${row.audio_bucket}/${row.audio_path}`,
      start_ms: row.audio_start_ms,
      end_ms: row.audio_end_ms,
      engines: row.engines ?? null,
      ...base,
    };
  }
  return { context: row.context ?? null, ...base };
}

const rows = await fetchRows();

const filtered = rows.filter((row) => {
  if (includeUnreviewedPii) return true;
  const fn = row.source_function ?? "";
  return !(CONVERSATION_SOURCES.has(fn) && row.pii_reviewed === false);
});
const piiExcluded = rows.length - filtered.length;

if (filtered.length === 0) {
  console.log("Nothing to export." + (piiExcluded ? ` (${piiExcluded} rows held for PII review)` : ""));
  process.exit(0);
}

// ── Group and write ──────────────────────────────────────────────────────────
const date = new Date().toISOString().slice(0, 10);
const outDir = join(process.cwd(), "training-exports", date);
const batchId = crypto.randomUUID();

const groups = new Map();
for (const row of filtered) {
  const key = `${row.task_type}_${row.dialect.toLowerCase()}_${tierFloor}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const audioRefs = new Set();
for (const row of filtered) {
  if (row.audio_path) audioRefs.add(`${row.audio_bucket}/${row.audio_path}`);
}

const summary = {
  batch_id: batchId,
  date,
  tier_floor: tierFloor,
  incremental: !includeExported,
  rows: filtered.length,
  pii_held: piiExcluded,
  distinct_audio_files: audioRefs.size,
  by_group: Object.fromEntries([...groups].map(([k, v]) => [k, v.length])),
  by_tier: Object.fromEntries(
    includedTiers.map((t) => [t, filtered.filter((r) => r.tier === t).length]),
  ),
  audio_ms: filtered.reduce(
    (sum, r) =>
      sum +
      (typeof r.audio_start_ms === "number" && typeof r.audio_end_ms === "number"
        ? Math.max(0, r.audio_end_ms - r.audio_start_ms)
        : 0),
    0,
  ),
};

console.log(JSON.stringify(summary, null, 2));

if (dryRun) {
  console.log("\n--dry-run: nothing written, nothing stamped.");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const written = [];
for (const [key, groupRows] of groups) {
  const file = join(outDir, `${key}.jsonl`);
  writeFileSync(file, groupRows.map((r) => JSON.stringify(toRecord(r))).join("\n") + "\n");
  written.push(file);
}
writeFileSync(join(outDir, "manifest.txt"), [...audioRefs].sort().join("\n") + "\n");
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
written.push(join(outDir, "manifest.txt"), join(outDir, "summary.json"));

// ── Stamp the batch ──────────────────────────────────────────────────────────
const ids = filtered.map((r) => r.id);
for (let i = 0; i < ids.length; i += 500) {
  const { error } = await supabase
    .from("training_examples")
    .update({ export_batch_id: batchId })
    .in("id", ids.slice(i, i + 500));
  if (error) {
    console.error(`batch stamp failed at ${i}: ${error.message}`);
    console.error("The files are written but some rows are unstamped; re-running will re-export them.");
    process.exit(1);
  }
}

if (upload) {
  for (const file of written) {
    const name = file.split("/").slice(-1)[0];
    const path = `exports/${date}/${name}`;
    const { error } = await supabase.storage
      .from("training-exports")
      .upload(path, readFileSync(file), { contentType: "application/octet-stream", upsert: true });
    if (error) console.error(`upload of ${path} failed: ${error.message}`);
    else console.log(`uploaded training-exports/${path}`);
  }
}

console.log(`\nWrote ${written.length} files to ${outDir} (batch ${batchId}).`);
