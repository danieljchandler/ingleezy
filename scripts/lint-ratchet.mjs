#!/usr/bin/env node
/**
 * Lint ratchet.
 *
 * The repo carries a large pre-existing lint debt (see BASELINE below). Gating
 * CI on a clean `npm run lint` would mean every build is red from day one,
 * which trains everyone to ignore the check — worse than having no check.
 * Gating on nothing lets the pile grow silently, which is how it got this big.
 *
 * So: fail only when the error count goes UP. Existing debt is tolerated,
 * new debt is not, and the number can be walked down over time.
 *
 * When you legitimately reduce the count, lower BASELINE in the same commit —
 * the script tells you the number to use. Warnings are reported but not
 * ratcheted; they're advisory in this config.
 *
 *   node scripts/lint-ratchet.mjs
 */
import { execFileSync } from "node:child_process";

/**
 * Maximum tolerated ESLint errors. Only ever goes down.
 * Last lowered: 532 → 531, when the set-phrase surfaces were flipped.
 */
const BASELINE = 531;

function runEslint() {
  try {
    // --format json puts machine-readable results on stdout. ESLint exits
    // non-zero when there are errors, which is the normal case here, so the
    // throw path is expected rather than exceptional.
    return execFileSync("npx", ["eslint", ".", "--format", "json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (typeof err.stdout === "string" && err.stdout.trim().startsWith("[")) {
      return err.stdout;
    }
    // A real failure — bad config, crash, OOM. Surface it rather than
    // reporting a misleading count of zero.
    console.error("Could not run ESLint:\n", err.stderr || err.message);
    process.exit(2);
  }
}

const results = JSON.parse(runEslint());

let errors = 0;
let warnings = 0;
/** @type {Map<string, number>} */
const byRule = new Map();

for (const file of results) {
  for (const msg of file.messages) {
    if (msg.severity === 2) {
      errors++;
      const rule = msg.ruleId ?? "(parse error)";
      byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    } else if (msg.severity === 1) {
      warnings++;
    }
  }
}

console.log(`ESLint: ${errors} errors, ${warnings} warnings (baseline ${BASELINE} errors)`);

if (errors > BASELINE) {
  console.error(`\n✗ Lint errors increased by ${errors - BASELINE}.`);
  console.error("  Fix the new ones — the baseline only moves down.\n");

  const top = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.error("  Most common rules across the repo:");
  for (const [rule, count] of top) console.error(`    ${String(count).padStart(4)}  ${rule}`);
  process.exit(1);
}

if (errors < BASELINE) {
  console.log(`\n✓ ${BASELINE - errors} fewer than baseline. Lower BASELINE to ${errors} in scripts/lint-ratchet.mjs.`);
} else {
  console.log("\n✓ No new lint errors.");
}
