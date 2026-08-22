import { describe, expect, it } from "vitest";
import {
  buildKnownTokenSet,
  comprehensionBand,
  comprehensionBarClass,
  comprehensionLabel,
  MIN_TOKENS,
  tokenizeEnglish,
  transcriptComprehension,
} from "./comprehension";

/**
 * The comprehension shelf's arithmetic. The stakes: this number tells a
 * learner whether a video is a comfortable watch or a wall, so it must not be
 * inflated (function words already carry it upward by design), it must refuse
 * to guess when the transcript is too small to measure — and it must measure
 * the ENGLISH, the language being acquired, never the Arabic scaffold.
 */

const line = (english: string) => ({ english, arabic: "الترجمة", translation: "…" });

/** Enough filler lines of knowable text to clear MIN_TOKENS. */
function filler(known: string, count: number) {
  return Array.from({ length: count }, () => line(known));
}

describe("tokenizeEnglish", () => {
  it("splits on punctuation and drops Arabic, digits and single letters", () => {
    expect(tokenizeEnglish("What do you want, يا 123 friend?")).toEqual([
      "what",
      "do",
      "you",
      "want",
      "friend",
    ]);
  });

  it("folds case and contractions so deck and transcript compare equal", () => {
    expect(tokenizeEnglish("Don't")).toEqual(tokenizeEnglish("dont"));
    expect(tokenizeEnglish("COFFEE")).toEqual(tokenizeEnglish("coffee"));
  });

  it("returns nothing for empty or non-English text", () => {
    expect(tokenizeEnglish("")).toEqual([]);
    expect(tokenizeEnglish("كلام عربي فقط")).toEqual([]);
  });
});

describe("buildKnownTokenSet", () => {
  it("contributes every content token of a saved phrase", () => {
    const known = buildKnownTokenSet(["grab some coffee"]);
    expect(known.has("coffee")).toBe(true);
    expect(known.size).toBe(3);
  });

  it("skips null and empty entries", () => {
    expect(buildKnownTokenSet([null, undefined, ""]).size).toBe(0);
  });
});

describe("transcriptComprehension", () => {
  it("counts saved words and function words as known", () => {
    const known = buildKnownTokenSet(["coffee"]);
    const lines = filler("coffee", MIN_TOKENS).concat([line("restaurant")]); // 20 known + 1 unknown
    const result = transcriptComprehension(lines, known)!;

    expect(result.totalTokens).toBe(MIN_TOKENS + 1);
    expect(result.unknownTokens).toBe(1);
    expect(result.coverage).toBeCloseTo(MIN_TOKENS / (MIN_TOKENS + 1), 5);
  });

  it("treats function words as known so beginners aren't shown 5% everywhere", () => {
    const lines = filler("this is the one that we do", 10); // closed class throughout
    const result = transcriptComprehension(lines, new Set())!;
    expect(result.coverage).toBe(1);
  });

  it("sees through the common inflections of a saved base form", () => {
    const known = buildKnownTokenSet(["want", "make"]);
    // wants/wanted/making → want/want/make: the inflections that most often
    // hide a known word from an exact match.
    const lines = filler("wants wanted making", MIN_TOKENS / 2);
    const result = transcriptComprehension(lines, known)!;
    expect(result.unknownTokens).toBe(0);
  });

  it("measures the English line, never the Arabic scaffold", () => {
    // A native Arabic speaker's coverage of the scaffold is always ~100%,
    // which is exactly why it must not be what the bar measures.
    const lines = Array.from({ length: 30 }, () => ({
      english: "unfamiliar vocabulary throughout",
      arabic: "كلام عربي معروف",
      translation: "…",
    }));
    const result = transcriptComprehension(lines, new Set())!;
    expect(result.coverage).toBe(0);
  });

  it("returns null for a bridged clip with no English lines", () => {
    const lines = Array.from({ length: 30 }, () => ({ arabic: "سطر عربي", translation: "an Arabic line" }));
    expect(transcriptComprehension(lines, new Set())).toBeNull();
  });

  it("refuses to score a transcript below the token floor", () => {
    expect(transcriptComprehension([line("one line")], new Set())).toBeNull();
  });

  it("returns null for a missing or empty transcript", () => {
    expect(transcriptComprehension(null, new Set())).toBeNull();
    expect(transcriptComprehension([], new Set())).toBeNull();
    expect(transcriptComprehension("not lines", new Set())).toBeNull();
  });

  it("skips malformed lines rather than crashing on them", () => {
    const lines = [null, { english: 42 }, ...filler("this is the one that we do", 10)];
    expect(transcriptComprehension(lines, new Set())).not.toBeNull();
  });
});

describe("the bands", () => {
  it("splits at the i+1 boundaries", () => {
    expect(comprehensionBand(0.95)).toBe("comfortable");
    expect(comprehensionBand(0.9)).toBe("comfortable");
    expect(comprehensionBand(0.89)).toBe("stretch");
    expect(comprehensionBand(0.7)).toBe("stretch");
    expect(comprehensionBand(0.69)).toBe("challenge");
  });

  it("gives every band a bar class and a label", () => {
    for (const band of ["comfortable", "stretch", "challenge"] as const) {
      expect(comprehensionBarClass(band)).toMatch(/^bg-/);
      expect(comprehensionLabel(band).length).toBeGreaterThan(0);
    }
  });
});
