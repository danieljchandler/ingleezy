import { describe, expect, it } from "vitest";
import {
  reconcileVerdicts,
  verdictCoverage,
} from "../../supabase/functions/_shared/corpusVettingCore";

const readMigration = async (name: string) => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  return readFile(resolve(`supabase/migrations/${name}`), "utf8");
};

// The pool is scraped wartime Twitter and the consumer is a content generator,
// so the model's silence must never be what lets a sentence through.
describe("reconcileVerdicts", () => {
  it("passes only an affirmative boolean true", () => {
    const d = reconcileVerdicts(3, [
      { i: 0, ok: true, reason: "everyday speech" },
      { i: 1, ok: false, reason: "war reporting" },
      { i: 2, ok: true, reason: "family chat" },
    ]);
    expect(d.map((x) => x.vetted)).toEqual([true, false, true]);
    expect(d[1].reason).toBe("war reporting");
  });

  it("rejects any sentence the model did not answer for", () => {
    // A truncated response is the realistic case: the model returns the first
    // few verdicts and stops.
    const d = reconcileVerdicts(4, [{ i: 0, ok: true, reason: "fine" }]);
    expect(d.map((x) => x.vetted)).toEqual([true, false, false, false]);
    expect(d[3].reason).toBe("no verdict returned");
  });

  it("rejects truthy non-booleans rather than coercing them", () => {
    const d = reconcileVerdicts(4, [
      { i: 0, ok: "true" },
      { i: 1, ok: 1 },
      { i: 2, ok: "yes" },
      { i: 3, ok: {} },
    ]);
    expect(d.every((x) => !x.vetted)).toBe(true);
  });

  it("ignores hallucinated indexes instead of trusting them", () => {
    const d = reconcileVerdicts(2, [
      { i: 5, ok: true, reason: "out of range" },
      { i: -1, ok: true, reason: "negative" },
      { i: 0, ok: true, reason: "real" },
    ]);
    expect(d).toHaveLength(2);
    expect(d[0].vetted).toBe(true);
    expect(d[1].vetted).toBe(false);
  });

  // Otherwise a model that emitted {i:0, ok:false} then {i:0, ok:true} could
  // talk itself into a pass.
  it("lets the first verdict for an index win, so a repeat cannot upgrade it", () => {
    const d = reconcileVerdicts(1, [
      { i: 0, ok: false, reason: "slur" },
      { i: 0, ok: true, reason: "actually fine" },
    ]);
    expect(d[0].vetted).toBe(false);
    expect(d[0].reason).toBe("slur");
  });

  it("survives garbage in place of a verdict list", () => {
    for (const junk of [null, undefined, "nope", 42, [null, 7, "x"], [{}]]) {
      const d = reconcileVerdicts(2, junk);
      expect(d).toHaveLength(2);
      expect(d.every((x) => !x.vetted)).toBe(true);
    }
  });
});

describe("verdictCoverage", () => {
  it("reports a partially answered batch", () => {
    expect(verdictCoverage(4, reconcileVerdicts(4, [{ i: 0, ok: true }]))).toBe(0.25);
    expect(
      verdictCoverage(2, reconcileVerdicts(2, [{ i: 0, ok: true }, { i: 1, ok: false }])),
    ).toBe(1);
  });
});

// The table is the boundary between scraped tweets and the app. These pin the
// properties that make seeding it inert and keep it away from learners.
describe("dialect_corpus_sentences migration", () => {
  it("grants nothing to anon and enables RLS", async () => {
    const sql = await readMigration("20260804130000_dialect_corpus_sentences.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/REVOKE ALL ON public\.dialect_corpus_sentences FROM anon/);
    expect(sql).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/);
  });

  it("leaves vetted nullable with no default, so seeded rows are inert", async () => {
    const sql = await readMigration("20260804130000_dialect_corpus_sentences.sql");
    const col = sql.match(/^\s*vetted\s+boolean.*$/m);
    expect(col).not.toBeNull();
    expect(col![0]).not.toMatch(/NOT NULL/i);
    expect(col![0]).not.toMatch(/DEFAULT/i);
  });

  it("restricts writes to service_role", async () => {
    const sql = await readMigration("20260804130000_dialect_corpus_sentences.sql");
    expect(sql).toMatch(/FOR ALL\s+TO service_role/);
    expect(sql).toMatch(/FOR SELECT\s+TO authenticated\s+USING \(public\.is_admin\(\)\)/);
  });
});

describe("corpus seed migration", () => {
  it("seeds no vetted value, so nothing is minable on arrival", async () => {
    const sql = await readMigration("20260804140000_seed_yemeni_corpus_sentences.sql");
    const cols = sql.match(/INSERT INTO public\.dialect_corpus_sentences\s*\(([^)]*)\)/);
    expect(cols).not.toBeNull();
    expect(cols![1]).not.toContain("vetted");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
  });

  it("carries the CC BY 4.0 attribution on every row", async () => {
    const sql = await readMigration("20260804140000_seed_yemeni_corpus_sentences.sql");
    const rows = [...sql.matchAll(/^\s*\('Yemeni',/gm)].length;
    const licensed = [...sql.matchAll(/'CC BY 4\.0'/g)].length;
    expect(rows).toBeGreaterThan(0);
    expect(licensed).toBe(rows);
  });
});
