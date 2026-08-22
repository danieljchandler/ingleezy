import { describe, expect, it } from "vitest";
import { phonemeSubstitutions, type WordResult } from "./useAzurePronunciation";

/**
 * The "you said X where Y goes" extractor. The stakes: for an Arabic speaker
 * the substitutions are the documented interference set (/p/→/b/, /v/→/f/),
 * and naming the swap is the whole coaching value — but only when Azure is
 * actually confident, so a well-scored phoneme must never produce a chip.
 */

const word = (w: string, phonemes: WordResult["phonemes"]): WordResult => ({
  word: w,
  accuracy: 70,
  errorType: "Mispronunciation",
  phonemes,
});

describe("phonemeSubstitutions", () => {
  it("reports a low-scored phoneme whose top alternative differs", () => {
    const subs = phonemeSubstitutions([
      word("people", [{ phoneme: "p", accuracy: 30, nbest: [{ phoneme: "b", accuracy: 85 }] }]),
    ]);
    expect(subs).toEqual([{ word: "people", target: "p", heard: "b" }]);
  });

  it("stays quiet about phonemes that scored fine", () => {
    const subs = phonemeSubstitutions([
      word("people", [{ phoneme: "p", accuracy: 92, nbest: [{ phoneme: "b", accuracy: 40 }] }]),
    ]);
    expect(subs).toEqual([]);
  });

  it("ignores a low score with no alternative or the same alternative", () => {
    const subs = phonemeSubstitutions([
      word("van", [
        { phoneme: "v", accuracy: 40 },
        { phoneme: "æ", accuracy: 45, nbest: [{ phoneme: "æ", accuracy: 50 }] },
      ]),
    ]);
    expect(subs).toEqual([]);
  });

  it("dedupes the same swap across words and caps the list", () => {
    const pb = (w: string) =>
      word(w, [{ phoneme: "p", accuracy: 20, nbest: [{ phoneme: "b", accuracy: 80 }] }]);
    const subs = phonemeSubstitutions([
      pb("park"),
      pb("pin"),
      word("very", [{ phoneme: "v", accuracy: 20, nbest: [{ phoneme: "f", accuracy: 80 }] }]),
      word("ship", [{ phoneme: "ʃ", accuracy: 20, nbest: [{ phoneme: "s", accuracy: 80 }] }]),
      word("this", [{ phoneme: "ð", accuracy: 20, nbest: [{ phoneme: "z", accuracy: 80 }] }]),
    ]);
    // p→b appears once despite two words; the list stops at three.
    expect(subs.map((s) => `${s.target}→${s.heard}`)).toEqual(["p→b", "v→f", "ʃ→s"]);
  });
});
