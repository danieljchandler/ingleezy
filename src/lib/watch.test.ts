import { describe, expect, it } from "vitest";
import type { TranscriptLine } from "@/types/transcript";
import {
  dialectName,
  formatClock,
  hasArabic,
  lineStopStep,
  lineView,
  nextSpeed,
  SPEEDS,
  supportLabel,
  videoLevel,
} from "./watch";

const line = (over: Partial<TranscriptLine>): TranscriptLine => ({
  id: "l1",
  arabic: "",
  translation: "",
  tokens: [],
  ...over,
});

describe("lineView", () => {
  it("puts the English first on an English video, with the dialect scaffold under it", () => {
    // The process-english-video shape: `english` spoken, `arabic` the scaffold,
    // no `translation` at all.
    const view = lineView(
      line({ english: "I'm not gonna lie, that was rough.", arabic: "ما راح أكذب عليك، كانت صعبة." }),
    );
    expect(view).toEqual({
      spoken: "I'm not gonna lie, that was rough.",
      spokenLang: "en",
      support: "ما راح أكذب عليك، كانت صعبة.",
    });
  });

  it("puts the Arabic first on a bridged Arabic video, with its English under it", () => {
    const view = lineView(line({ arabic: "شلونك اليوم؟", translation: "How are you today?" }));
    expect(view).toEqual({ spoken: "شلونك اليوم؟", spokenLang: "ar", support: "How are you today?" });
  });

  it("treats a blank `english` as an Arabic line rather than an empty English one", () => {
    expect(lineView(line({ english: "  ", arabic: "هلا", translation: "Hi" })).spokenLang).toBe("ar");
  });

  it("gives an empty support line when there is nothing to show", () => {
    expect(lineView(line({ english: "Hello" })).support).toBe("");
  });
});

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [4_900, "0:04"],
    [64_000, "1:04"],
    [192_000, "3:12"],
    [-500, "0:00"],
  ])("%i ms reads %s", (ms, clock) => {
    expect(formatClock(ms)).toBe(clock);
  });
});

describe("nextSpeed", () => {
  it("steps through every speed and comes back to normal", () => {
    const seen = [1];
    for (let i = 0; i < SPEEDS.length; i++) seen.push(nextSpeed(seen[seen.length - 1]));
    expect(seen).toEqual([1, 0.75, 0.5, 1.25, 1]);
  });

  it("goes back to normal from a speed that is not on the list", () => {
    expect(nextSpeed(1.5)).toBe(1);
  });
});

describe("dialectName", () => {
  it("names the dialect in Arabic", () => {
    expect(dialectName("Gulf")).toBe("خليجي");
    expect(dialectName("Egyptian")).toBe("مصري");
  });

  it("falls back to the stored value, and to nothing for none", () => {
    expect(dialectName("Sudanese")).toBe("Sudanese");
    expect(dialectName(null)).toBe("");
  });
});

describe("videoLevel", () => {
  it("prefers the CEFR band", () => {
    expect(videoLevel({ cefr_level: "a2", difficulty: "Beginner" })).toBe("A2");
  });

  it("falls back to the difficulty, in Arabic", () => {
    expect(videoLevel({ cefr_level: null, difficulty: "Intermediate" })).toBe("متوسط");
    expect(videoLevel({ difficulty: "Unknown" })).toBe("Unknown");
    expect(videoLevel({})).toBe("");
  });
});

describe("supportLabel", () => {
  it("names the learner's dialect on an English video", () => {
    expect(supportLabel("Gulf", "en")).toBe("الترجمة بالخليجي");
    expect(supportLabel("Egyptian", "en")).toBe("الترجمة بالمصري");
  });

  it("says English on an Arabic video, whatever the dialect", () => {
    expect(supportLabel("Gulf", "ar")).toBe("الترجمة بالإنجليزي");
  });

  it("says just translation for a dialect it cannot name", () => {
    expect(supportLabel("Sudanese", "en")).toBe("الترجمة");
    expect(supportLabel(undefined, "en")).toBe("الترجمة");
  });
});

describe("hasArabic", () => {
  it("spots Arabic letters, alone or mixed in", () => {
    expect(hasArabic("سوالف الدوام")).toBe(true);
    expect(hasArabic("Small talk — سوالف")).toBe(true);
    expect(hasArabic("Small talk at work")).toBe(false);
    expect(hasArabic(null)).toBe(false);
  });
});

describe("lineStopStep", () => {
  const lines = [
    { startMs: 1000, endMs: 4000 },
    { startMs: 4200, endMs: 7000 },
    { startMs: 7000, endMs: 9000 },
  ];
  const at = (nowMs: number, over: Partial<Parameters<typeof lineStopStep>[0]> = {}) =>
    lineStopStep({ nowMs, startMs: 1000, endMs: 4000, stoppedAtEnd: false, lines, ...over });

  it("does nothing inside the line", () => {
    expect(at(2500)).toEqual({ kind: "none" });
  });

  it("stops at the end of the line", () => {
    expect(at(4000)).toEqual({ kind: "pause" });
    expect(at(4180)).toEqual({ kind: "pause" });
  });

  it("moves on to the next line when played on after the stop, rather than stopping again", () => {
    expect(at(4100, { stoppedAtEnd: true })).toEqual({ kind: "follow", index: 1 });
  });

  it("follows a jump forward without stopping", () => {
    expect(at(8000)).toEqual({ kind: "follow", index: 2 });
  });

  it("follows a jump back without stopping", () => {
    expect(at(5000, { startMs: 7000, endMs: 9000 })).toEqual({ kind: "follow", index: 1 });
  });

  it("plays on past the last line", () => {
    expect(at(9100, { startMs: 7000, endMs: 9000, stoppedAtEnd: true })).toEqual({ kind: "follow", index: -1 });
    expect(at(9500, { startMs: null, endMs: null })).toEqual({ kind: "none" });
  });

  it("picks the line back up after the end when the learner scrubs back into one", () => {
    expect(at(5000, { startMs: null, endMs: null })).toEqual({ kind: "follow", index: 1 });
  });
});
