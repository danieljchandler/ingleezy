import { describe, expect, it } from "vitest";
import { splitLatinRuns } from "./latinRuns";

describe("splitLatinRuns", () => {
  it("keeps a multi-word English fix as one run", () => {
    expect(splitLatinRuns("قول «I went to the market» لأن yesterday ماضي.")).toEqual([
      { text: "قول «", latin: false },
      { text: "I went to the market", latin: true },
      { text: "» لأن ", latin: false },
      { text: "yesterday", latin: true },
      { text: " ماضي.", latin: false },
    ]);
  });

  it("keeps contractions and hyphens inside the run, and trailing spaces out of it", () => {
    expect(splitLatinRuns("I'm well-known هنا")).toEqual([
      { text: "I'm well-known", latin: true },
      { text: " هنا", latin: false },
    ]);
  });

  it("returns all-Arabic and all-English text whole", () => {
    expect(splitLatinRuns("كلام عربي بس")).toEqual([{ text: "كلام عربي بس", latin: false }]);
    expect(splitLatinRuns("Just English")).toEqual([{ text: "Just English", latin: true }]);
  });

  it("returns nothing for nothing", () => {
    expect(splitLatinRuns("")).toEqual([]);
  });

  it("loses no characters", () => {
    const text = "Say أنا بخير, not أنا بخيرة.";
    expect(splitLatinRuns(text).map((r) => r.text).join("")).toBe(text);
  });
});
