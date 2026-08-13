import { describe, expect, it } from "vitest";
import { findLineContainingWord } from "./vocabularyAudioContext";

/**
 * Finding the sentence a saved word came from.
 *
 * When a learner taps a word in a transcript to save it, this is what decides
 * which line goes into their deck as context — and, through that line's
 * timings, which slice of audio gets clipped and stored with the card. Pick the
 * wrong line and the card plays a sentence the word is not in.
 *
 * The match is done on de-vocalised text, because the transcript carries
 * tashkeel and the tapped word usually does not. That normalisation is the only
 * clever part, and it is a substring match, which has consequences worth
 * pinning.
 */

const aLine = (arabic: string, over: Record<string, unknown> = {}) => ({
  arabic,
  translation: `translation of ${arabic}`,
  startMs: 0,
  endMs: 1000,
  ...over,
});

describe("matching a word to its line", () => {
  it("returns the line, its translation and its timings", () => {
    const lines = [aLine("شلونك اليوم", { startMs: 2000, endMs: 4500 })];

    const found = findLineContainingWord(lines, "اليوم");

    expect(found).toEqual({
      sentenceText: "شلونك اليوم",
      sentenceEnglish: "translation of شلونك اليوم",
      startMs: 2000,
      endMs: 4500,
    });
  });

  it("returns null when the word appears in none of them", () => {
    const lines = [aLine("شلونك اليوم"), aLine("الحمد لله")];

    expect(findLineContainingWord(lines, "مطبخ")).toBeNull();
  });

  it("returns null for an empty transcript", () => {
    expect(findLineContainingWord([], "اليوم")).toBeNull();
  });

  it("takes the first line that contains the word", () => {
    const lines = [
      aLine("first", { arabic: "أروح السوق", startMs: 0 }),
      aLine("second", { arabic: "أروح البيت", startMs: 5000 }),
    ];

    const found = findLineContainingWord(lines, "أروح");

    // A word repeated across a clip should anchor to where it was first heard,
    // which is the line the learner was most likely reading.
    expect(found?.startMs).toBe(0);
  });

  it("carries a line with no translation through", () => {
    const lines = [{ arabic: "شلونك اليوم", startMs: 0, endMs: 1000 }];

    const found = findLineContainingWord(lines, "اليوم");

    // Untranslated lines are normal mid-pipeline; the sentence is still worth
    // saving.
    expect(found?.sentenceText).toBe("شلونك اليوم");
    expect(found?.sentenceEnglish).toBeUndefined();
  });

  it("carries a line with no timings through", () => {
    const lines = [{ arabic: "شلونك اليوم" }];

    const found = findLineContainingWord(lines, "اليوم");

    // No timings means no clip, but the sentence context is still useful — a
    // card with text and no audio beats no card.
    expect(found?.sentenceText).toBe("شلونك اليوم");
    expect(found?.startMs).toBeUndefined();
  });
});

describe("looking past the vowel marks", () => {
  it("finds a bare word inside a vocalised line", () => {
    const lines = [aLine("شَلُونَكْ اليَوْم")];

    // The transcript is vocalised and the tapped token is not — the common
    // case, and the whole reason for the normalisation.
    expect(findLineContainingWord(lines, "اليوم")?.sentenceText).toBe("شَلُونَكْ اليَوْم");
  });

  it("finds a vocalised word inside a bare line", () => {
    const lines = [aLine("شلونك اليوم")];

    expect(findLineContainingWord(lines, "اليَوْم")?.sentenceText).toBe("شلونك اليوم");
  });

  it("matches when both carry different vowel marks", () => {
    const lines = [aLine("شَلُونَك اليَوْمَ")];

    expect(findLineContainingWord(lines, "اليَوْم")).not.toBeNull();
  });

  it("ignores surrounding whitespace on the word", () => {
    const lines = [aLine("شلونك اليوم")];

    expect(findLineContainingWord(lines, "  اليوم  ")).not.toBeNull();
  });

  it("returns the line as written, not as normalised", () => {
    const lines = [aLine("شَلُونَكْ اليَوْم")];

    // The stored sentence is shown to the learner, so it has to keep its
    // tashkeel — normalising for the comparison must not leak into the result.
    expect(findLineContainingWord(lines, "اليوم")?.sentenceText).toBe("شَلُونَكْ اليَوْم");
  });
});

describe("what a substring match costs", () => {
  it("matches a word inside a longer word", () => {
    const lines = [aLine("الكتابة مهمة")];

    // Pinned, not fixed. "كتاب" (book) matches inside "الكتابة" (writing),
    // because the check is `includes` with no word-boundary handling. The
    // learner saves "book" and the card carries a sentence about writing —
    // plausible enough that nobody notices, and Arabic's prefixes and suffixes
    // make this the normal case rather than an edge one.
    expect(findLineContainingWord(lines, "كتاب")?.sentenceText).toBe("الكتابة مهمة");
  });

  it("matches across a definite article the learner did not tap", () => {
    const lines = [aLine("رحت السوق")];

    // The flip side, and the reason a boundary-aware match cannot simply be
    // dropped in: "سوق" has to match "السوق", or tapping a word with the
    // article attached would find nothing at all.
    expect(findLineContainingWord(lines, "سوق")).not.toBeNull();
  });

  it("matches an empty word against the first line", () => {
    const lines = [aLine("شلونك اليوم"), aLine("الحمد لله")];

    // Pinned. Every string contains "", so a blank tap silently anchors the
    // card to whatever line happens to be first rather than returning null.
    expect(findLineContainingWord(lines, "")?.sentenceText).toBe("شلونك اليوم");
    expect(findLineContainingWord(lines, "   ")?.sentenceText).toBe("شلونك اليوم");
  });

  it("matches a word made only of vowel marks against the first line", () => {
    const lines = [aLine("شلونك اليوم")];

    // Same shape: normalisation strips the marks, leaving the empty string.
    expect(findLineContainingWord(lines, "َُِ")?.sentenceText).toBe("شلونك اليوم");
  });
});
