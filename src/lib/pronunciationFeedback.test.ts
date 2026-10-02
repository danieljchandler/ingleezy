import { describe, expect, it } from "vitest";
import {
  heardInstead,
  normalizePhoneme,
  soundForPhoneme,
  weakestSound,
  WEAK_PHONEME,
} from "./pronunciationFeedback";

const word = (w: string, phonemes: Array<[string, number]>) => ({
  word: w,
  accuracy: 80,
  errorType: "None" as const,
  phonemes: phonemes.map(([phoneme, accuracy]) => ({ phoneme, accuracy })),
});

describe("normalizePhoneme", () => {
  it("drops length and stress marks and the slashes", () => {
    expect(normalizePhoneme("iː")).toBe("i");
    expect(normalizePhoneme("ˈæ")).toBe("æ");
    expect(normalizePhoneme("/p/")).toBe("p");
  });

  it("folds the American r and the IPA g to the letters the sounds data uses", () => {
    expect(normalizePhoneme("ɹ")).toBe("r");
    expect(normalizePhoneme("ɡ")).toBe("g");
  });
});

describe("soundForPhoneme", () => {
  it("finds the stop that teaches a consonant", () => {
    expect(soundForPhoneme("p")?.code).toBe("p");
    expect(soundForPhoneme("v")?.code).toBe("v");
    expect(soundForPhoneme("θ")?.code).toBe("th_voiceless");
    expect(soundForPhoneme("tʃ")?.code).toBe("ch");
  });

  it("finds a vowel through either side of its pair, with or without the length mark", () => {
    expect(soundForPhoneme("iː")?.code).toBe("beat_bit");
    expect(soundForPhoneme("ɪ")?.code).toBe("beat_bit");
  });

  it("finds r as the scorer writes it", () => {
    expect(soundForPhoneme("ɹ")?.code).toBe("r");
  });

  it("returns nothing for a sound the journey does not teach", () => {
    expect(soundForPhoneme("ə")).toBeUndefined();
  });
});

describe("weakestSound", () => {
  it("picks the worst phoneme under the bar, with the word it was in", () => {
    const weak = weakestSound({
      words: [word("park", [["p", 41], ["ɑ", 90], ["ɹ", 65], ["k", 95]])],
    });
    expect(weak).toMatchObject({ phoneme: "p", accuracy: 41, word: "park" });
    expect(weak?.sound?.code).toBe("p");
  });

  it("says nothing when every phoneme cleared the bar", () => {
    expect(weakestSound({ words: [word("park", [["p", WEAK_PHONEME], ["k", 95]])] })).toBeNull();
  });

  it("prefers, on a tie, the sound it can teach", () => {
    const weak = weakestSound({ words: [word("the van", [["ə", 30], ["v", 30]])] });
    expect(weak?.phoneme).toBe("v");
  });

  it("copes with words that came back without phonemes", () => {
    expect(weakestSound({ words: [{ ...word("hi", []), phonemes: undefined as never }] })).toBeNull();
  });
});

describe("heardInstead", () => {
  it("names what was heard when it differs", () => {
    expect(heardInstead("park", "Bark.")).toBe("Bark.");
  });

  it("ignores case, punctuation and spacing", () => {
    expect(heardInstead("How are you?", "how are  you")).toBeNull();
  });

  it("says nothing when nothing was heard", () => {
    expect(heardInstead("park", "")).toBeNull();
    expect(heardInstead("park", undefined)).toBeNull();
  });
});
