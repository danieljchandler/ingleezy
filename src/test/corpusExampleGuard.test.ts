import { describe, expect, it } from "vitest";
import {
  guardExamples,
  isProposalUsable,
  MAX_EXAMPLE_WORDS,
  screenExample,
} from "../../supabase/functions/_shared/corpusExampleGuard";

// mine-dialect-corpus asks the council to cite corpus text verbatim, and those
// citations are folded into every generator prompt by dialectHelpers. With the
// Lisan corpus in scope that source text is wartime Twitter, so the guard is
// the boundary between raw scraped text and learner-facing content.
describe("screenExample", () => {
  it("accepts a short attested pattern", () => {
    // The shape a grounded rule should cite: the pattern, not its context.
    expect(screenExample("ما عاد").ok).toBe(true);
    expect(screenExample("اللي").ok).toBe(true);
    expect(screenExample("ما هوش").ok).toBe(true);
  });

  it("rejects a whole sentence lifted from the corpus", () => {
    const tweet = "لايوجد اجمل من اليمن في ارضها وسماها وناسها بس مشكلتنا حكوماتها";
    const verdict = screenExample(tweet);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("too_long");
  });

  it("rejects anything past the word cap even when short", () => {
    const verdict = screenExample("واحد اثنين ثلاثة اربعة خمسة");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("too_many_words");
  });

  // The length cap and the term screen fail differently on purpose: this is
  // short enough to pass the cap, and is exactly what must not be quoted.
  it("rejects a short but factional citation", () => {
    const verdict = screenExample("العفافيش");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("screened_term");
  });

  // عفاش is not a substring of العفافيش — that is precisely how the corpus
  // derivation's own stop-list let the slur through, so the stems are stored
  // short enough to catch inflections.
  it("catches inflected forms, not just the bare stem", () => {
    for (const w of ["الحوثيين", "المليشيات", "الخونه"]) {
      expect(screenExample(w).ok, w).toBe(false);
    }
  });

  // Cultural vocabulary is legitimate Yemeni content and appears in the seeded
  // rulebook's own cultural_references row. Over-screening would gut it.
  it("does not screen ordinary Yemeni cultural vocabulary", () => {
    for (const w of ["قات", "مفرج", "جنبيه", "سلته", "بنت الصحن"]) {
      expect(screenExample(w).ok, w).toBe(true);
    }
  });

  it("rejects non-strings rather than letting them through unscreened", () => {
    expect(screenExample({ msa: "ليس", dialect: "مش" }).ok).toBe(false);
    expect(screenExample(null).ok).toBe(false);
    expect(screenExample("").ok).toBe(false);
  });
});

describe("guardExamples", () => {
  it("keeps clean examples, drops the rest, and says why", () => {
    const guarded = guardExamples({
      good: ["ما عاد", "لايوجد اجمل من اليمن في ارضها وسماها وناسها بس مشكلتنا"],
      bad: ["ليس", "الحوثيين"],
    });
    expect(guarded.good).toEqual(["ما عاد"]);
    expect(guarded.bad).toEqual(["ليس"]);
    expect(guarded.dropped).toHaveLength(2);
    expect(guarded.dropped.map((d) => d.reason).join(" ")).toContain("screened_term");
  });

  it("screens the bad array too — it becomes forbidden tokens and admin UI", () => {
    const guarded = guardExamples({ good: ["بس"], bad: ["مليشيا"] });
    expect(guarded.bad).toEqual([]);
  });

  it("survives missing or malformed input", () => {
    expect(guardExamples(undefined)).toMatchObject({ good: [], bad: [] });
    expect(guardExamples({ good: "not an array" })).toMatchObject({ good: [] });
  });
});

describe("isProposalUsable", () => {
  // A rule that lost every good example is no longer grounded in the corpus,
  // which was the reason to cite one at all.
  it("rejects a proposal whose good examples were all screened out", () => {
    expect(isProposalUsable(guardExamples({ good: ["الحوثيين"], bad: ["ليس"] }))).toBe(
      false,
    );
  });

  it("accepts one that kept at least one good example", () => {
    expect(isProposalUsable(guardExamples({ good: ["ما عاد"], bad: [] }))).toBe(true);
  });
});

// The tool schema is what the model actually reads, so the cap has to be stated
// there as well as enforced after the fact. If they drift, the council keeps
// proposing examples that the guard then silently throws away.
describe("miner tool schema", () => {
  it("states the same word cap the guard enforces", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const src = await readFile(
      resolve("supabase/functions/mine-dialect-corpus/index.ts"),
      "utf8",
    );
    expect(src).toContain("MAX_EXAMPLE_WORDS");
    expect(src).toMatch(/at most \$\{MAX_EXAMPLE_WORDS\} words/);
    expect(MAX_EXAMPLE_WORDS).toBeGreaterThan(0);
  });
});
