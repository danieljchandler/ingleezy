import { describe, expect, it } from "vitest";
import { ARABIC_LETTERS } from "@/data/arabicAlphabet";
import {
  buildDrill,
  coverageBase,
  KEYBOARD_ROWS,
  keyForChar,
  keystrokeMatches,
  lettersThrough,
  normalizeChar,
  scoreDrill,
  TYPING_STAGES,
  typingTarget,
} from "./typingDrills";

/**
 * The typing trainer's whole promise is progressive introduction: stage 1
 * never asks for a key the learner has not met. That property — and the
 * keyboard data it depends on — is what these tests pin.
 */

describe("keyboard layout", () => {
  it("covers all 28 alphabet letters on the base layer", () => {
    for (const letter of ARABIC_LETTERS) {
      expect(keyForChar(letter.isolated), `${letter.name_translit} has no key`).toBeDefined();
    }
  });

  it("assigns each key one character and each character one key", () => {
    const chars = KEYBOARD_ROWS.flat().map((k) => k.char);
    const qwerty = KEYBOARD_ROWS.flat().map((k) => k.qwerty);
    expect(new Set(chars).size).toBe(chars.length);
    expect(new Set(qwerty).size).toBe(qwerty.length);
  });

  it("finds the key for a hamza-carrier form via the fold", () => {
    // أ is shift-layer; the trainer folds it to the plain alif key.
    expect(keyForChar("أ")?.qwerty).toBe("H");
  });
});

describe("normalisation", () => {
  it("folds hamza-carrier alifs to plain alif", () => {
    expect(normalizeChar("أ")).toBe("ا");
    expect(normalizeChar("إ")).toBe("ا");
    expect(normalizeChar("آ")).toBe("ا");
    expect(normalizeChar("ب")).toBe("ب");
  });

  it("strips diacritics and off-layout characters from a typing target", () => {
    // Fully vocalised بَيْت still types as بيت.
    expect(typingTarget("بَيْت")).toBe("بيت");
    expect(typingTarget("أرنب")).toBe("ارنب");
  });

  it("accepts either side of a fold as a matching keystroke", () => {
    expect(keystrokeMatches("ا", "أ")).toBe(true);
    expect(keystrokeMatches("أ", "ا")).toBe(true);
    expect(keystrokeMatches("ب", "ت")).toBe(false);
  });
});

describe("stages", () => {
  it("mirrors the Alphabet Journey's four checkpoint groups of seven", () => {
    expect(TYPING_STAGES).toHaveLength(4);
    for (const stage of TYPING_STAGES) expect(stage.letters).toHaveLength(7);
    // Between them, the whole alphabet, in order.
    const all = TYPING_STAGES.flatMap((s) => s.letters.map((l) => l.code));
    expect(all).toEqual(ARABIC_LETTERS.map((l) => l.code));
  });

  it("accumulates known letters stage over stage", () => {
    expect(lettersThrough(0).size).toBe(7);
    expect(lettersThrough(3).size).toBe(28);
    // Everything known at stage 0 is still known at stage 3.
    for (const c of lettersThrough(0)) expect(lettersThrough(3).has(c)).toBe(true);
  });

  it("counts a variant glyph as its base letter", () => {
    expect(coverageBase("ة")).toBe("ه");
    expect(coverageBase("ى")).toBe("ي");
    expect(coverageBase("ء")).toBe("ا");
  });
});

describe("drills", () => {
  it("teaches the stage's seven letters first", () => {
    const drill = buildDrill(0);
    const letters = drill.filter((d) => d.kind === "letter");
    expect(letters.map((d) => d.display)).toEqual(
      TYPING_STAGES[0].letters.map((l) => l.isolated),
    );
  });

  it("never asks for a key that has not been introduced", () => {
    for (const stage of TYPING_STAGES) {
      const known = lettersThrough(stage.index);
      for (const item of buildDrill(stage.index)) {
        for (const c of item.target) {
          if (c === " ") continue;
          expect(
            known.has(coverageBase(c)),
            `stage ${stage.index} drill "${item.display}" needs ${c}`,
          ).toBe(true);
        }
      }
    }
  });

  it("includes real example words once their letters are available", () => {
    // باب (door) is ba + alif + ba — alif and ba are both in stage 1.
    const words = buildDrill(0).filter((d) => d.kind === "word");
    expect(words.length).toBeGreaterThan(0);
    expect(words.map((d) => d.display)).toContain("باب");
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
