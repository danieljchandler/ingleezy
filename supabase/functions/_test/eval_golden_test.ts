import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { detectMsaLeaks } from "../_shared/msaLeakDetector.ts";

/**
 * The dialect eval harness's offline half (audit item B2).
 *
 * eval/golden/<dialect>.jsonl is a frozen, human-curated set of prompts with
 * a `good` reference (authentic dialect) and a `bad` counterexample (MSA or
 * wrong-dialect). Two consumers:
 *
 *   - THIS test, in CI: every `good` must scan clean by the hardcoded MSA-leak
 *     detector and every `bad` must trip it. That pins the detector and the
 *     golden set against each other — a detector change that starts flagging
 *     authentic dialect (or forgiving MSA) turns the build red, and so does a
 *     careless golden addition.
 *
 *   - scripts/eval-dialect-live.ts, run manually with API keys: sends each
 *     prompt to the model under test and scores the output with the same
 *     detector, so a model swap in modelRegistry.ts can be measured before it
 *     ships instead of discovered in production.
 *
 * The set grows from the flywheel: scripts/seed-eval-from-flywheel.mjs turns
 * gold native corrections into candidate rows for curation. Only the hardcoded
 * detector lists apply here — rulebook tokens live in the database, which this
 * suite deliberately never touches.
 */

interface GoldenRow {
  id: string;
  prompt: string;
  good: string;
  bad: string;
  note?: string;
}

const GOLDEN_DIR = fromFileUrl(new URL("./eval/golden/", import.meta.url));

const DIALECTS: Array<{ file: string; dialect: "Gulf" | "Egyptian" | "Yemeni" }> = [
  { file: "gulf.jsonl", dialect: "Gulf" },
  { file: "egyptian.jsonl", dialect: "Egyptian" },
  { file: "yemeni.jsonl", dialect: "Yemeni" },
];

function loadGolden(file: string): GoldenRow[] {
  const text = Deno.readTextFileSync(`${GOLDEN_DIR}${file}`);
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as GoldenRow);
}

for (const { file, dialect } of DIALECTS) {
  Deno.test(`golden ${dialect}: every row is complete and uniquely identified`, () => {
    const rows = loadGolden(file);
    assert(rows.length >= 10, `expected at least 10 ${dialect} rows, found ${rows.length}`);
    const ids = new Set<string>();
    for (const row of rows) {
      assert(row.id && row.prompt && row.good && row.bad, `incomplete row: ${row.id || "(no id)"}`);
      assert(!ids.has(row.id), `duplicate id ${row.id}`);
      ids.add(row.id);
    }
  });

  Deno.test(`golden ${dialect}: every good reference scans clean`, () => {
    for (const row of loadGolden(file)) {
      const { leaks } = detectMsaLeaks(row.good, dialect);
      assertEquals(
        leaks,
        [],
        `${row.id}: authentic reference tripped the detector on [${leaks.join(", ")}] — ` +
          `either the reference is not clean dialect or the detector grew a false positive`,
      );
    }
  });

  Deno.test(`golden ${dialect}: every bad counterexample trips the detector`, () => {
    for (const row of loadGolden(file)) {
      const { leaks } = detectMsaLeaks(row.bad, dialect);
      assert(
        leaks.length > 0,
        `${row.id}: the MSA/wrong-dialect counterexample scanned clean — ` +
          `either it lost its offending token or the detector went blind to it`,
      );
    }
  });
}
