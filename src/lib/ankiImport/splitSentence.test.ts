import { describe, expect, it } from "vitest";
import { splitWordAndSentence } from "./splitSentence";

/**
 * Deciding whether an Anki "word" field is really a word.
 *
 * Anki decks are authored by whoever made them, and a great many put a whole
 * example sentence in the front field. Importing that verbatim gives a learner
 * a flashcard whose headword is a sentence — unreviewable, unsearchable, and
 * impossible to match against a transcript later. So this guesses, and the
 * guess is a heuristic with no user-facing correction.
 *
 * The rule: an explicit sentence field is always trusted; otherwise the word is
 * treated as a sentence if it has four or more tokens, or terminal punctuation,
 * or three tokens of Arabic.
 */

describe("when the deck already separates them", () => {
  it("keeps both fields as they are", () => {
    const result = splitWordAndSentence({
      word: "باب",
      sentence: "فتحت الباب ودخلت البيت",
    });

    // An explicit sentence field means the deck author already made this
    // decision; second-guessing it would be worse than the heuristic.
    expect(result).toEqual({ word: "باب", sentence: "فتحت الباب ودخلت البيت" });
  });

  it("trusts the deck even when the word looks like a sentence too", () => {
    const result = splitWordAndSentence({
      word: "فتحت الباب ودخلت البيت",
      sentence: "مثال آخر",
    });

    expect(result.word).toBe("فتحت الباب ودخلت البيت");
  });

  it("trims both", () => {
    const result = splitWordAndSentence({ word: "  باب  ", sentence: "  جملة  " });

    expect(result).toEqual({ word: "باب", sentence: "جملة" });
  });
});

describe("a genuine headword", () => {
  it("leaves a single word alone", () => {
    expect(splitWordAndSentence({ word: "باب" })).toEqual({ word: "باب" });
  });

  it("leaves a two-word phrase alone", () => {
    // Idafa constructions and common collocations are headwords, not
    // sentences.
    expect(splitWordAndSentence({ word: "باب البيت" })).toEqual({ word: "باب البيت" });
  });

  it("leaves a short English phrase alone", () => {
    expect(splitWordAndSentence({ word: "good morning" })).toEqual({ word: "good morning" });
  });

  it("returns an empty word for an empty field", () => {
    expect(splitWordAndSentence({})).toEqual({ word: "" });
    expect(splitWordAndSentence({ word: "   " })).toEqual({ word: "" });
  });
});

describe("a sentence hiding in the word field", () => {
  it("splits four or more tokens", () => {
    const result = splitWordAndSentence({ word: "فتحت الباب ودخلت البيت" });

    expect(result.sentence).toBe("فتحت الباب ودخلت البيت");
    expect(result.word).toBe("فتحت");
  });

  it("splits three Arabic tokens", () => {
    const result = splitWordAndSentence({ word: "أنا أحب القهوة" });

    // Three tokens is a sentence in Arabic far more often than in English,
    // which is why the rule is dialect-aware.
    expect(result.sentence).toBe("أنا أحب القهوة");
    expect(result.word).toBe("أنا");
  });

  it("leaves three English tokens as a phrase", () => {
    // The same count in English is usually a collocation — "as soon as".
    expect(splitWordAndSentence({ word: "as soon as" })).toEqual({ word: "as soon as" });
  });

  it("splits anything with terminal punctuation, however short", () => {
    for (const text of ["روح!", "وين؟", "نعم."]) {
      const result = splitWordAndSentence({ word: text });
      expect(result.sentence, `${text} should read as a sentence`).toBe(text);
    }
  });

  it("recognises Arabic punctuation as well as Latin", () => {
    // The Arabic question mark and comma are different code points; matching
    // only the Latin ones would miss most Arabic decks.
    expect(splitWordAndSentence({ word: "شلونك اليوم؟" }).sentence).toBeDefined();
    expect(splitWordAndSentence({ word: "نعم، أكيد" }).sentence).toBeDefined();
  });

  it("strips punctuation off the headword it lifts out", () => {
    const result = splitWordAndSentence({ word: "نعم، أنا أحب القهوة" });

    // The headword goes into the deck and is matched against transcripts, so a
    // trailing comma would stop it ever matching.
    expect(result.word).toBe("نعم");
  });

  it("picks the first Arabic token as the headword", () => {
    const result = splitWordAndSentence({ word: "I said مرحبا to him today" });

    // The English words are scaffolding from the deck author; the Arabic is
    // what is being learned.
    expect(result.word).toBe("مرحبا");
    expect(result.sentence).toBe("I said مرحبا to him today");
  });

  it("skips a one-letter Arabic token when looking for a headword", () => {
    const result = splitWordAndSentence({ word: "و هو ذهب إلى السوق" });

    // A bare conjunction is not a word worth studying.
    expect(result.word).not.toBe("و");
    expect(result.word).toBe("هو");
  });

  it("falls back to the first token when nothing is Arabic", () => {
    const result = splitWordAndSentence({ word: "the quick brown fox jumps" });

    // Pinned. An all-English sentence still gets split, and the headword
    // becomes "the" — a card for the English definite article. The import has
    // no way to reject a card, so a deck with English on both sides produces
    // rows like this rather than being skipped.
    expect(result.word).toBe("the");
    expect(result.sentence).toBe("the quick brown fox jumps");
  });
});
