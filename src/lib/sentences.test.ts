import { describe, expect, it } from "vitest";
import { pairSentences, splitSentences } from "./sentences";

/**
 * Splitting a body into the cards a learner reads one at a time, and deciding
 * which translation goes on which card.
 *
 * The second half is the part with teeth. Pairing is by position, so a
 * translation whose sentence count disagrees with the Arabic's would put the
 * wrong meaning under every line after the disagreement — and that meaning is
 * what the word lookup sends to the model and what the learner saves onto a
 * flashcard. The rule is that a mismatch drops the translation entirely.
 */

describe("splitSentences", () => {
  it("splits on the Latin sentence endings", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });

  it("splits on the Arabic question mark", () => {
    // ؟ is a different code point from ?, and dialect text uses it.
    expect(splitSentences("سؤال؟ جواب.")).toEqual(["سؤال؟", "جواب."]);
  });

  it("treats a line break as an ending", () => {
    expect(splitSentences("سطر أول\nسطر ثاني")).toEqual(["سطر أول", "سطر ثاني"]);
  });

  it("keeps text with no punctuation whole", () => {
    expect(splitSentences("جملة بدون علامات")).toEqual(["جملة بدون علامات"]);
  });

  it("drops the empty piece a trailing full stop leaves", () => {
    expect(splitSentences("جملة. ")).toEqual(["جملة."]);
  });

  it("returns nothing for an empty body", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("pairSentences", () => {
  const arabic = "الجملة الأولى. الجملة الثانية. الجملة الثالثة.";

  it("lines the translations up sentence by sentence", () => {
    expect(
      pairSentences({
        arabic: "الأولى. الثانية.",
        transliteration: "al-uula. ath-thaaniya.",
        english: "The first. The second.",
        literal: "the-first. the-second.",
      }),
    ).toEqual([
      {
        arabic: "الأولى.",
        transliteration: "al-uula.",
        english: "The first.",
        literal: "the-first.",
      },
      {
        arabic: "الثانية.",
        transliteration: "ath-thaaniya.",
        english: "The second.",
        literal: "the-second.",
      },
    ]);
  });

  it("drops a translation that splits into a different number of sentences", () => {
    // Two English sentences over three Arabic ones means line two and line
    // three are both mislabelled — worse than an unlabelled line.
    const lines = pairSentences({
      arabic,
      english: "The first one. The rest of it, run together.",
    });
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.english === undefined)).toBe(true);
  });

  it("keeps the fields that do line up when another does not", () => {
    const lines = pairSentences({
      arabic,
      transliteration: "al-jumla al-uula. ath-thaaniya. ath-thaalitha.",
      english: "Everything, in one sentence.",
    });
    expect(lines.map((l) => l.transliteration)).toEqual([
      "al-jumla al-uula.",
      "ath-thaaniya.",
      "ath-thaalitha.",
    ]);
    expect(lines.every((l) => l.english === undefined)).toBe(true);
  });

  it("gives a one-sentence body its whole translation however it splits", () => {
    // Nothing can be mispaired when there is only one line to pair with.
    expect(
      pairSentences({
        arabic: "جملة واحدة",
        english: "One sentence. Rendered as two.",
      }),
    ).toEqual([
      {
        arabic: "جملة واحدة",
        transliteration: undefined,
        english: "One sentence. Rendered as two.",
        literal: undefined,
      },
    ]);
  });

  it("leaves absent translations absent rather than empty", () => {
    const [line] = pairSentences({ arabic: "جملة.", english: null, literal: "  " });
    expect(line.english).toBeUndefined();
    expect(line.literal).toBeUndefined();
  });

  it("returns nothing for an empty body", () => {
    expect(pairSentences({ arabic: "", english: "Something." })).toEqual([]);
  });
});
