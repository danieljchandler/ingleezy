import { describe, expect, it } from "vitest";
import {
  ALWAYS_ALLOWED,
  normalizeArabic,
} from "../../supabase/functions/_shared/msaLeakDetector";

const MIGRATION =
  "supabase/migrations/20260804120000_yemeni_corpus_rule_drafts.sql";

async function loadRules() {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const sql = await readFile(resolve(MIGRATION), "utf8");
  const blobs = [...sql.matchAll(/'(\{"good"[\s\S]*?\})',/g)].map((m) =>
    JSON.parse(m[1]),
  );
  return { sql, blobs };
}

// These rows seed dialect_rules from the Lisan corpus. Two failure modes are
// invisible at review time and expensive later, so they are pinned here.
describe("Yemeni corpus rule drafts", () => {
  it("parses, and every rule carries both example arrays", async () => {
    const { blobs } = await loadRules();
    expect(blobs.length).toBeGreaterThan(0);
    for (const b of blobs) {
      expect(Array.isArray(b.good)).toBe(true);
      expect(Array.isArray(b.bad)).toBe(true);
    }
  });

  // harvestForbiddenTokens drops any bad example that sits in ALWAYS_ALLOWED,
  // so a rule arguing against a whitelisted form does nothing at all — it just
  // reads as policy that is silently never applied. هذا/هذه are the live case:
  // the corpus put them on the whitelist, so no rule may argue against them.
  it("never argues against a form the whitelist permits", async () => {
    const { blobs } = await loadRules();
    const allowed = ALWAYS_ALLOWED.Yemeni;
    const voided: string[] = [];
    for (const b of blobs) {
      for (const bad of b.bad as unknown[]) {
        if (typeof bad !== "string") continue;
        if (allowed.has(normalizeArabic(bad))) voided.push(bad);
      }
    }
    expect(voided, "bad examples that ALWAYS_ALLOWED.Yemeni would drop").toEqual(
      [],
    );
  });

  // Approval is a separate, deliberate step. The seed stays draft-only so the
  // history shows a human decided; 20260804150000 is that decision.
  it("seeds only drafts, attributed to the corpus", async () => {
    const { sql } = await loadRules();
    const statuses = [...sql.matchAll(/'(draft|approved|retired)',\s*'(\w+)'/g)];
    expect(statuses.length).toBeGreaterThan(0);
    for (const [, status, source] of statuses) {
      expect(status).toBe("draft");
      expect(source).toBe("corpus_mined");
    }
  });
});

// These rules are live now, so the approval must not be broader than intended:
// a future mine-dialect-corpus run's drafts would otherwise be swept into
// production by a migration that has nothing to do with them.
describe("Yemeni corpus rule approval", () => {
  const APPROVAL = "supabase/migrations/20260804150000_approve_yemeni_corpus_rules.sql";

  const loadApproval = async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    return readFile(resolve(APPROVAL), "utf8");
  };

  it("approves only this corpus's Yemeni drafts", async () => {
    const sql = await loadApproval();
    expect(sql).toMatch(/dialect\s*=\s*'Yemeni'/);
    expect(sql).toMatch(/source\s*=\s*'corpus_mined'/);
    expect(sql).toMatch(/notes LIKE 'Lisan%'/);
    // Idempotent, and cannot resurrect anything an admin has since retired.
    expect(sql).toMatch(/status\s*=\s*'draft'/);
  });

  it("touches dialect_rules and nothing else", async () => {
    const sql = await loadApproval();
    // Strip comments before splitting: prose is allowed to contain semicolons.
    const statements = sql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^UPDATE public\.dialect_rules/);
  });
});
