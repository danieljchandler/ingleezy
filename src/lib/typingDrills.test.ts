import { describe, expect, it } from "vitest";
import { ENGLISH_SOUNDS } from "@/data/englishSounds";
import { buildDrill, keystrokeMatches, scoreDrill, SPELLING_STAGES } from "./typingDrills";

/**
 * The spelling trainer replaced a progressive Arabic-keyboard drill — see
 * the module doc comment for why English needed a spelling drill rather
 * than a keyboard-layout one. What's left to pin: the stage grouping
 * mirrors the English Sounds journey's four checkpoints, the drill draws
 * only from that stage's sounds, and the scoring math (untouched from the
 * Arabic version) still holds.
 */

describe("normalisation", () => {
  it("matches a keystroke regardless of case", () => {
    expect(keystrokeMatches("P", "p")).toBe(true);
    expect(keystrokeMatches("p", "P")).toBe(true);
    expect(keystrokeMatches("b", "p")).toBe(false);
  });
});

describe("stages", () => {
  it("mirrors the English Sounds journey's four checkpoint groups of seven", () => {
    expect(SPELLING_STAGES).toHaveLength(4);
    for (const stage of SPELLING_STAGES) expect(stage.sounds).toHaveLength(7);
    // Between them, every sound, in order.
    const all = SPELLING_STAGES.flatMap((s) => s.sounds.map((snd) => snd.code));
    expect(all).toEqual(ENGLISH_SOUNDS.map((s) => s.code));
  });
});

describe("drills", () => {
  it("draws only from the stage's own sounds", () => {
    for (const stage of SPELLING_STAGES) {
      const stageWords = new Set(
        stage.sounds.flatMap((s) => s.examples.map((e) => e.en.toLowerCase())),
      );
      for (const item of buildDrill(stage.index)) {
        expect(stageWords.has(item.target)).toBe(true);
      }
    }
  });

  it("lowercases the target but keeps the word's normal casing to display", () => {
    const drill = buildDrill(0);
    for (const item of drill) {
      expect(item.target).toBe(item.display.toLowerCase());
    }
  });

  it("carries the Arabic gloss through", () => {
    const drill = buildDrill(0);
    expect(drill[0].ar.length).toBeGreaterThan(0);
  });

  it("drops a word repeated across two sounds in the same stage rather than drilling it twice", () => {
    // "bag" is both /b/'s final-position example and final_devoicing's — but
    // final_devoicing is stage 4, so within one stage the more common case is
    // two different sounds sharing an example word by coincidence. Either
    // way the drill must never show the same target twice.
    for (const stage of SPELLING_STAGES) {
      const drill = buildDrill(stage.index);
      const targets = drill.map((d) => d.target);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });

  it("is deterministic", () => {
    expect(buildDrill(2)).toEqual(buildDrill(2));
  });

  it("returns nothing for an out-of-range stage", () => {
    expect(buildDrill(9)).toEqual([]);
  });
});

describe("scoring", () => {
  it("is 100 before anything is typed", () => {
    expect(scoreDrill(0, 0).accuracy).toBe(100);
  });

  it("rounds accuracy to a whole percentage", () => {
    expect(scoreDrill(3, 1).accuracy).toBe(67);
    expect(scoreDrill(10, 0).accuracy).toBe(100);
  });

  it("never goes below zero, however wild the error count", () => {
    expect(scoreDrill(2, 50).accuracy).toBe(0);
  });
});
