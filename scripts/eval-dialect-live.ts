#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net
/**
 * Live half of the dialect eval harness (audit item B2) — measures a model
 * against the frozen golden set BEFORE a swap ships, instead of discovering
 * regressions in production.
 *
 * For every golden prompt (supabase/functions/_test/eval/golden/*.jsonl) it
 * asks the model under test for a reply in the dialect, then scores the reply
 * with the same hardcoded MSA-leak detector CI pins the golden set against
 * (supabase/functions/_test/eval_golden_test.ts is the offline half). Output:
 * leak rate per dialect and every offending reply, so two runs — current
 * model vs candidate — give a side-by-side answer to "did dialect fidelity
 * move?".
 *
 * Usage:
 *   OPENROUTER_API_KEY=... deno run --allow-env --allow-read --allow-net \
 *     scripts/eval-dialect-live.ts --model anthropic/claude-sonnet-5 [--dialect Gulf] [--limit 10]
 *
 * Models on the Lovable gateway instead of OpenRouter:
 *   LOVABLE_API_KEY=... deno run ... --model google/gemini-3.5-flash --gateway lovable
 *
 * Deliberately does NOT go through askBrain: the Brain adds repair passes and
 * validators, which would measure the pipeline, not the model. This measures
 * the raw model under the same dialect identity prompt the Brain uses.
 */
import { detectMsaLeaks } from "../supabase/functions/_shared/msaLeakDetector.ts";
import {
  getDialectIdentity,
  getDialectVocabRules,
  type Dialect,
} from "../supabase/functions/_shared/dialectHelpers.ts";

interface GoldenRow {
  id: string;
  prompt: string;
  good: string;
  bad: string;
}

const args = Deno.args;
const opt = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

const model = opt("model");
if (!model) {
  console.error("Usage: eval-dialect-live.ts --model <id> [--dialect Gulf|Egyptian|Yemeni] [--limit N] [--gateway openrouter|lovable]");
  Deno.exit(2);
}
const gateway = opt("gateway") ?? "openrouter";
const dialectFilter = opt("dialect");
const limit = Number(opt("limit")) || Infinity;

const url = gateway === "lovable"
  ? "https://ai.gateway.lovable.dev/v1/chat/completions"
  : "https://openrouter.ai/api/v1/chat/completions";
const apiKey = Deno.env.get(gateway === "lovable" ? "LOVABLE_API_KEY" : "OPENROUTER_API_KEY");
if (!apiKey) {
  console.error(`${gateway === "lovable" ? "LOVABLE_API_KEY" : "OPENROUTER_API_KEY"} is not set.`);
  Deno.exit(2);
}

const GOLDEN: Array<{ file: string; dialect: Dialect }> = [
  { file: "gulf.jsonl", dialect: "Gulf" },
  { file: "egyptian.jsonl", dialect: "Egyptian" },
  { file: "yemeni.jsonl", dialect: "Yemeni" },
];

function loadGolden(file: string): GoldenRow[] {
  const path = new URL(`../supabase/functions/_test/eval/golden/${file}`, import.meta.url);
  return Deno.readTextFileSync(path)
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldenRow);
}

async function generate(dialect: Dialect, prompt: string): Promise<string> {
  // The same stable identity + vocabulary block the Brain prepends.
  const system = `${getDialectIdentity(dialect)}\n\n${getDialectVocabRules(dialect)}\n\nReply with ONE natural spoken sentence in the dialect. No commentary, no transliteration.`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content ?? "");
}

let totalRuns = 0;
let totalLeaky = 0;
const failures: Array<{ id: string; dialect: string; reply: string; leaks: string[] }> = [];

for (const { file, dialect } of GOLDEN) {
  if (dialectFilter && dialect !== dialectFilter) continue;
  const rows = loadGolden(file).slice(0, limit);
  let leaky = 0;
  for (const row of rows) {
    let reply = "";
    try {
      reply = await generate(dialect, row.prompt);
    } catch (e) {
      console.error(`  ${row.id}: generation failed — ${e instanceof Error ? e.message : e}`);
      continue;
    }
    totalRuns++;
    const { leaks } = detectMsaLeaks(reply, dialect);
    if (leaks.length > 0) {
      leaky++;
      totalLeaky++;
      failures.push({ id: row.id, dialect, reply: reply.slice(0, 160), leaks });
    }
  }
  console.log(`${dialect}: ${rows.length - leaky}/${rows.length} clean (${leaky} leaked)`);
}

if (failures.length) {
  console.log("\nLeaky replies:");
  for (const f of failures) {
    console.log(`  ${f.id} [${f.leaks.join(", ")}]: ${f.reply}`);
  }
}
const rate = totalRuns ? ((totalLeaky / totalRuns) * 100).toFixed(1) : "n/a";
console.log(`\n${model}: ${totalLeaky}/${totalRuns} replies leaked (${rate}%).`);
