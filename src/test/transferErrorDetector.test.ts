import { describe, expect, it } from "vitest";
import {
  BUILTIN_TRANSFER_PATTERNS,
  detectTransferErrors,
} from "../../supabase/functions/_shared/transferErrorDetector";
import {
  FALLBACK_INTERFERENCE_RULES,
  harvestTransferPatterns,
  isMatchablePattern,
  renderEnglishIdentity,
  renderInterferenceGuidance,
  MATCHABLE_CATEGORIES,
} from "../../supabase/functions/_shared/englishPromptCore";

// The detector is the English-target mirror of msaLeakDetector: a lexical
// matcher for Arabic-shaped English that is wrong in essentially any context.
// The failure mode these tests guard is the same one harvestForbiddenTokens
// guards on the Arabic side — poisoning the matcher with patterns that need
// grammatical context ("he go") and flagging innocent text.

describe("detectTransferErrors", () => {
  it("catches a calque with its suggestion", () => {
    const r = detectTransferErrors("Please open the light for me.");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].category).toBe("calque");
    expect(r.errors[0].match.toLowerCase()).toBe("open the light");
    expect(r.errors[0].suggestion).toBe("turn on the light");
  });

  it("catches preposition transfer", () => {
    const r = detectTransferErrors("She is married from a doctor.");
    expect(r.errors.map((e) => e.category)).toContain("preposition");
  });

  it("catches p/b spelling swaps as whole words only", () => {
    expect(detectTransferErrors("I have a broblem.").errors).toHaveLength(1);
    // The correct word must never be flagged.
    expect(detectTransferErrors("I have a problem.").errors).toHaveLength(0);
  });

  it("matches case-insensitively and across flexible whitespace", () => {
    expect(detectTransferErrors("OPEN THE  LIGHT").errors).toHaveLength(1);
  });

  it("reports each occurrence with its offset, sorted", () => {
    const text = "open the light, then close the phone";
    const r = detectTransferErrors(text);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].index).toBeLessThan(r.errors[1].index);
    expect(text.slice(r.errors[0].index)).toMatch(/^open the light/);
  });

  it("returns none for Arabic-only or empty input", () => {
    expect(detectTransferErrors("").severity).toBe("none");
    expect(detectTransferErrors("مرحبا كيف حالك").severity).toBe("none");
  });

  it("walks the severity ladder", () => {
    expect(detectTransferErrors("all good here").severity).toBe("none");
    expect(detectTransferErrors("open the light").severity).toBe("low");
    expect(detectTransferErrors("open the light and close the phone").severity).toBe("medium");
  });

  it("lets caller-supplied rulebook patterns override built-ins", () => {
    const r = detectTransferErrors("open the light", [
      { pattern: "open the light", category: "calque", rule_id: "rule-1", suggestion: "switch on the light" },
    ]);
    expect(r.errors[0].rule_id).toBe("rule-1");
    expect(r.errors[0].suggestion).toBe("switch on the light");
  });
});

describe("pattern harvesting", () => {
  it("never harvests grammar-shaped categories", () => {
    // "he go" inside "where did he go" is innocent — grammar errors need
    // context-aware grading, so copula/article/morphology must not become
    // lexical patterns no matter what the rulebook contains.
    for (const p of BUILTIN_TRANSFER_PATTERNS) {
      expect(MATCHABLE_CATEGORIES.has(p.category)).toBe(true);
    }
    expect(detectTransferErrors("Where did he go?").errors).toHaveLength(0);
    expect(detectTransferErrors("The report is ready, she is happy.").errors).toHaveLength(0);
  });

  it("aligns the good example at the same index as the suggestion", () => {
    const patterns = harvestTransferPatterns(FALLBACK_INTERFERENCE_RULES);
    const closePhone = patterns.find((p) => p.pattern === "close the phone");
    expect(closePhone?.suggestion).toBe("hang up the phone");
  });

  it("rejects non-English, long, and out-of-category strings", () => {
    expect(isMatchablePattern("افتح النور", "calque")).toBe(false);
    expect(isMatchablePattern("this pattern is far too long to match", "calque")).toBe(false);
    expect(isMatchablePattern("he go", "morphology")).toBe(false);
    expect(isMatchablePattern("open the light", "calque")).toBe(true);
  });

  it("dedupes repeated bad examples across rules", () => {
    const rules = [
      { category: "calque", rule: "a", examples: { bad: ["open the light"], good: ["turn on the light"] }, priority: 4 },
      { category: "calque", rule: "b", examples: { bad: ["open the light"], good: ["switch on"] }, priority: 3 },
    ];
    expect(harvestTransferPatterns(rules)).toHaveLength(1);
  });
});

describe("prompt rendering", () => {
  it("identity block conditions on known CEFR levels and skips unknown ones", () => {
    expect(renderEnglishIdentity("A1")).toContain("CEFR A1");
    expect(renderEnglishIdentity("Z9")).not.toContain("CEFR");
    expect(renderEnglishIdentity()).not.toContain("CEFR");
  });

  it("guidance renders highest-priority rules first with a contrastive pair", () => {
    const g = renderInterferenceGuidance(FALLBACK_INTERFERENCE_RULES);
    expect(g).toContain("COMMON ARABIC-SPEAKER ERRORS");
    expect(g).toContain('❌ "I am student" → ✅ "I am a student"');
    // priority-5 article rule must appear before the priority-3 spelling rule
    expect(g.indexOf("[article]")).toBeLessThan(g.indexOf("[spelling]"));
  });

  it("guidance is empty for an empty rulebook", () => {
    expect(renderInterferenceGuidance([])).toBe("");
  });
});
