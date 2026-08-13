import { describe, it, expect } from "vitest";
import {
  ARBITER_MIN_MARGIN,
  ARBITER_MIN_SCORE,
  arbitrateDispute,
  contentSimilarity,
  jaccard,
  normalizeForCompare,
  type ArbiterCandidate,
} from "../../supabase/functions/_shared/translationArbiter";

const cand = (name: string, text: string, weight = 1, literal = ""): ArbiterCandidate =>
  ({ name, text, weight, literal });

describe("normalizeForCompare", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeForCompare("  The  CAT—sat, (down)!  ")).toBe("the cat sat down");
  });

  it("tolerates null-ish input", () => {
    expect(normalizeForCompare("")).toBe("");
  });
});

describe("jaccard", () => {
  it("is 1 for identical token sets regardless of punctuation and case", () => {
    expect(jaccard("The cat sat.", "the CAT sat")).toBe(1);
  });

  it("is 0 for disjoint token sets", () => {
    expect(jaccard("alpha beta", "gamma delta")).toBe(0);
  });

  it("is 1 when both sides are empty", () => {
    expect(jaccard("", "")).toBe(1);
  });

  it("is 0 when only one side is empty", () => {
    expect(jaccard("", "something")).toBe(0);
  });

  it("scores partial overlap by intersection over union", () => {
    // {a,b,c} vs {b,c,d} → 2 shared of 4 distinct
    expect(jaccard("a b c", "b c d")).toBeCloseTo(0.5, 5);
  });
});

describe("arbitrateDispute", () => {
  it("picks the candidate the arbiter clearly backs", () => {
    const verdict = arbitrateDispute("he went to the market yesterday", [
      cand("claude", "he went to the market yesterday"),
      cand("qwen", "she cooked dinner for her family"),
    ]);
    expect(verdict.winner?.name).toBe("claude");
    expect(verdict.score).toBe(1);
  });

  it("carries the winner's literal gloss through", () => {
    const verdict = arbitrateDispute("the boy ate bread", [
      cand("claude", "the boy ate bread", 1, "boy the ate bread"),
      cand("qwen", "nothing similar whatsoever here"),
    ]);
    expect(verdict.winner?.literal).toBe("boy the ate bread");
  });

  it("settles a near-tie by corroboration rather than leaving it flagged", () => {
    // Both candidates are backed by the arbiter, so neither is a quality risk.
    // Requiring a clear margin here is what left 8 of 8 disputed lines in the
    // review queue on a real run.
    const verdict = arbitrateDispute("the cat sat on the mat", [
      cand("qwen", "the cat sat on the mat", 0.5),
      cand("claude", "the cat sat on the mat", 1),
    ]);
    expect(verdict.winner?.name).toBe("claude"); // higher weight wins the tie
    expect(verdict.mode).toBe("corroborated");
  });

  it("does not corroborate when the arbiter backs nobody", () => {
    const verdict = arbitrateDispute("entirely different subject matter", [
      cand("claude", "the cat sat down"),
      cand("gemini", "the cat sat still"),
    ]);
    expect(verdict.winner).toBeNull();
    expect(verdict.reason).toBe("below_threshold");
  });

  it("only corroborates among candidates that clear the score bar", () => {
    // claude and gemini are both close to the arbiter; qwen is not, and must
    // not win on weight alone.
    const verdict = arbitrateDispute("he went to the market yesterday", [
      cand("claude", "he went to the market yesterday", 1),
      cand("gemini", "he went to the market today", 1),
      cand("qwen", "unrelated wording entirely here", 1),
    ]);
    expect(verdict.winner?.name).not.toBe("qwen");
  });

  it("refuses to choose when nothing is close enough", () => {
    const verdict = arbitrateDispute("completely unrelated wording", [
      cand("claude", "the cat sat down"),
      cand("qwen", "a dog barked loudly"),
    ]);
    expect(verdict.winner).toBeNull();
    expect(verdict.reason).toBe("below_threshold");
    expect(verdict.score).toBeLessThan(ARBITER_MIN_SCORE);
  });

  it("reports when the arbiter said nothing", () => {
    expect(arbitrateDispute("", [cand("claude", "anything")]).reason).toBe("no_arbiter_text");
    expect(arbitrateDispute("   ", [cand("claude", "anything")]).reason).toBe("no_arbiter_text");
    expect(arbitrateDispute(null, [cand("claude", "anything")]).reason).toBe("no_arbiter_text");
  });

  it("reports when there is nothing to arbitrate between", () => {
    expect(arbitrateDispute("a rendering", []).reason).toBe("no_candidates");
    expect(arbitrateDispute("a rendering", [cand("claude", "  ")]).reason).toBe("no_candidates");
  });

  it("can settle a line against a single candidate, with no runner-up", () => {
    const verdict = arbitrateDispute("he sells fish at the souq", [
      cand("claude", "he sells fish at the souq"),
    ]);
    expect(verdict.winner?.name).toBe("claude");
    expect(verdict.mode).toBe("nearest");
    expect(verdict.margin).toBe(verdict.score);
  });

  it("leaves a lone candidate alone when the arbiter disagrees with it", () => {
    const verdict = arbitrateDispute("he sells fish at the souq", [
      cand("qwen", "the weather turned cold overnight"),
    ]);
    expect(verdict.winner).toBeNull();
    expect(verdict.reason).toBe("below_threshold");
  });

  it("honours caller-supplied thresholds", () => {
    // 0.909 vs 0.833 — both plainly on topic, neither clearly nearer.
    const arbiter = "a b c d e f g h i j";
    const candidates = [
      cand("claude", "a b c d e f g h i j k"),
      cand("qwen", "a b c d e f g h i j k l"),
    ];
    // Within the default margin, so this is a corroborated settlement...
    const settled = arbitrateDispute(arbiter, candidates);
    expect(settled.mode).toBe("corroborated");
    expect(settled.margin).toBeLessThan(ARBITER_MIN_MARGIN);
    // ...but raising the score bar above both puts it back in the queue.
    const strict = arbitrateDispute(arbiter, candidates, { minScore: 0.95 });
    expect(strict.winner).toBeNull();
    expect(strict.reason).toBe("below_threshold");
    // A permissive margin makes it a plain nearest-match instead.
    expect(
      arbitrateDispute(arbiter, candidates, { minMargin: 0 }).mode,
    ).toBe("nearest");
  });

  it("breaks exact score ties toward the higher-weight model before margin applies", () => {
    const verdict = arbitrateDispute("a b c", [
      cand("qwen", "a b c", 0.5),
      cand("claude", "a b c", 1),
    ], { minMargin: 0 });
    expect(verdict.winner?.name).toBe("claude");
  });

  it("exposes thresholds that keep arbitration stricter than a coin flip", () => {
    expect(ARBITER_MIN_SCORE).toBeGreaterThan(0);
    expect(ARBITER_MIN_MARGIN).toBeGreaterThan(0);
  });
});

describe("contentSimilarity", () => {
  it("ignores the function words every English sentence shares", () => {
    // Nothing in common but stopwords — full-token overlap scores this well
    // above zero, which is what made every candidate look alike.
    const a = "he went to the market";
    const b = "he was in the house";
    expect(contentSimilarity(a, b)).toBeLessThan(jaccard(a, b));
    expect(contentSimilarity(a, b)).toBe(0);
  });

  it("separates a paraphrase from an unrelated line far more sharply", () => {
    const arbiter = "the man sells fish at the market";
    const near = "the man sold fish in the market";
    const far = "the weather turned cold last night";
    // The gap is what the arbiter decides on, so it has to be wide.
    const contentGap = contentSimilarity(arbiter, near) - contentSimilarity(arbiter, far);
    const tokenGap = jaccard(arbiter, near) - jaccard(arbiter, far);
    expect(contentGap).toBeGreaterThan(tokenGap);
  });

  it("falls back to plain overlap when a line is all function words", () => {
    expect(contentSimilarity("it is on it", "it is on it")).toBe(1);
  });

  it("is still 1 for identical text and 0 for disjoint content", () => {
    expect(contentSimilarity("he sells fish", "he sells fish")).toBe(1);
    expect(contentSimilarity("he sells fish", "she bought bread")).toBe(0);
  });
});

describe("arbitrateDispute — relative decisions", () => {
  it("settles the case four audits reported as unresolvable", () => {
    // Low absolute similarity to both, but decisively nearer to one. Under the
    // old 0.45 absolute bar this returned below_threshold and stayed flagged.
    const verdict = arbitrateDispute("the merchant sells fish beside the mosque", [
      cand("claude", "the trader sells fish near the mosque"),
      cand("qwen", "prices went up again this winter"),
    ]);
    expect(verdict.winner?.name).toBe("claude");
    expect(verdict.mode).toBe("nearest");
    expect(verdict.score).toBeLessThan(0.45); // would have failed the old bar
  });

  it("decides on a ratio when the absolute gap is too small for the margin", () => {
    // 0.231 vs 0.143 — a margin of 0.088, under the 0.1 bar, but a ratio of
    // 1.6. At these magnitudes the ratio is the signal that survives.
    const verdict = arbitrateDispute("alpha beta gamma delta epsilon zeta eta theta", [
      cand("claude", "alpha beta gamma kappa lambda mu nu xi"),
      cand("qwen", "delta epsilon rho sigma tau upsilon phi chi"),
    ]);
    expect(verdict.margin).toBeLessThan(ARBITER_MIN_MARGIN);
    expect(verdict.winner?.name).toBe("claude");
    expect(verdict.mode).toBe("nearest");
  });

  it("still refuses when the arbiter shares essentially nothing", () => {
    const verdict = arbitrateDispute("completely unrelated subject matter", [
      cand("claude", "the boy ate bread"),
      cand("qwen", "the girl drank water"),
    ]);
    expect(verdict.winner).toBeNull();
    expect(verdict.reason).toBe("below_threshold");
  });

  it("requires the high bar before corroborating a genuine tie", () => {
    // Both score 0.2: above the noise floor, tied exactly, and well under the
    // corroboration bar. No preference can be read and no quality claim is
    // supported, so the line stays in the queue.
    const verdict = arbitrateDispute("alpha beta gamma delta epsilon zeta", [
      cand("claude", "alpha beta kappa lambda mu nu"),
      cand("qwen", "gamma delta kappa lambda mu nu"),
    ]);
    expect(verdict.score).toBeGreaterThan(ARBITER_MIN_SCORE);
    expect(verdict.score).toBeLessThan(0.45);
    expect(verdict.winner).toBeNull();
    expect(verdict.reason).toBe("too_close");
  });

  it("corroborates a tie when the arbiter genuinely backs both", () => {
    const verdict = arbitrateDispute("the merchant sells fresh fish daily", [
      cand("qwen", "the merchant sells fresh fish daily", 0.5),
      cand("claude", "the merchant sells fresh fish daily", 1),
    ]);
    expect(verdict.mode).toBe("corroborated");
    expect(verdict.winner?.name).toBe("claude");
  });

  it("never promotes a candidate the arbiter does not back at all", () => {
    const verdict = arbitrateDispute("the merchant sells fresh fish", [
      cand("claude", "the merchant sells fresh fish", 0.5),
      cand("qwen", "unrelated wording entirely", 1),
    ]);
    expect(verdict.winner?.name).toBe("claude");
  });
});
