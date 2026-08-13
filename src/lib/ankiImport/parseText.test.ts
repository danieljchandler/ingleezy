import { describe, expect, it } from "vitest";
import { parseAnkiText } from "./parseText";
import { ANKI_IMPORT_LIMIT } from "./types";

/**
 * Reading a plain-text Anki export.
 *
 * This is the import path most learners actually use — Anki's "Notes in Plain
 * Text" is one menu item away, where exporting an `.apkg` is not. The file has
 * no schema: fields are positional, the separator varies, HTML may or may not
 * be escaped, and Anki writes optional `#` directives on the front that a
 * naive parser reads as data.
 *
 * The consequential decision is which column holds the Arabic, because it is
 * inferred rather than declared. Getting it wrong produces a deck of cards
 * whose front and back are swapped, which is only obvious after a review
 * session has already scheduled them.
 */

const fileOf = (content: string, name = "deck.txt"): File =>
  ({ name, text: async () => content }) as unknown as File;

describe("finding the fields", () => {
  it("reads a tab-separated pair", async () => {
    const deck = await parseAnkiText(fileOf("باب\tdoor\nكتاب\tbook"));

    expect(deck.cards).toHaveLength(2);
    expect(deck.cards[0]).toMatchObject({ wordArabic: "باب", wordEnglish: "door" });
    expect(deck.cards[1]).toMatchObject({ wordArabic: "كتاب", wordEnglish: "book" });
  });

  it("finds the Arabic whichever column it is in", async () => {
    const deck = await parseAnkiText(fileOf("door\tباب"));

    // Half of all decks are English-first. Assuming column order would swap
    // every card in those.
    expect(deck.cards[0]).toMatchObject({ wordArabic: "باب", wordEnglish: "door" });
  });

  it("takes a second Arabic column as the example sentence", async () => {
    const deck = await parseAnkiText(fileOf("باب\tdoor\tفتحت الباب ودخلت"));

    expect(deck.cards[0]).toMatchObject({
      wordArabic: "باب",
      wordEnglish: "door",
      sentenceArabic: "فتحت الباب ودخلت",
    });
  });

  it("skips a row with no Arabic at all", async () => {
    const deck = await parseAnkiText(fileOf("باب\tdoor\nhello\tworld\nكتاب\tbook"));

    // A card with no Arabic teaches nothing here, and importing it would put a
    // blank headword in the deck.
    expect(deck.cards).toHaveLength(2);
    expect(deck.cards.map((c) => c.wordArabic)).toEqual(["باب", "كتاب"]);
  });

  it("keeps a card whose English side is missing", async () => {
    const deck = await parseAnkiText(fileOf("باب\t"));

    // The learner may know the word and want it in their deck for review; an
    // absent translation is recoverable, a dropped card is not.
    expect(deck.cards[0]).toMatchObject({ wordArabic: "باب", wordEnglish: "" });
  });
});

describe("the separator", () => {
  it("honours a declared tab", async () => {
    const deck = await parseAnkiText(fileOf("#separator:tab\nباب\tdoor"));

    expect(deck.cards[0].wordArabic).toBe("باب");
  });

  it("honours a declared comma", async () => {
    const deck = await parseAnkiText(fileOf("#separator:comma\nباب,door"));

    expect(deck.cards[0]).toMatchObject({ wordArabic: "باب", wordEnglish: "door" });
  });

  it("honours a declared semicolon", async () => {
    const deck = await parseAnkiText(fileOf("#separator:semicolon\nباب;door"));

    expect(deck.cards[0]).toMatchObject({ wordArabic: "باب", wordEnglish: "door" });
  });

  it("detects a tab when nothing is declared", async () => {
    const deck = await parseAnkiText(fileOf("باب\tdoor"));

    expect(deck.cards[0].wordEnglish).toBe("door");
  });

  it("assumes a comma for a .csv file", async () => {
    const deck = await parseAnkiText(fileOf("باب,door", "deck.csv"));

    expect(deck.cards[0].wordEnglish).toBe("door");
  });
});

describe("the directive block", () => {
  it("does not import the directives as cards", async () => {
    const deck = await parseAnkiText(
      fileOf("#separator:tab\n#html:true\n#notetype:Basic\nباب\tdoor"),
    );

    // Anki writes several of these; treating them as rows produces cards whose
    // front is "#notetype:Basic".
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].wordArabic).toBe("باب");
  });

  it("strips HTML when the file says it is HTML", async () => {
    const deck = await parseAnkiText(
      fileOf("#separator:tab\n#html:true\n<b>باب</b>\t<i>door</i>"),
    );

    // Markup in a headword breaks every downstream comparison — dedupe,
    // transcript matching, and the review card's own rendering.
    expect(deck.cards[0]).toMatchObject({ wordArabic: "باب", wordEnglish: "door" });
  });

  it("reads a tags column and keeps it out of the fields", async () => {
    const deck = await parseAnkiText(
      fileOf("#separator:tab\n#tags column:3\nباب\tdoor\tnouns household"),
    );

    expect(deck.cards[0].tags).toEqual(["nouns", "household"]);
    // The tag string must not also be read as an example sentence.
    expect(deck.cards[0].sentenceArabic).toBeUndefined();
  });

  it("leaves tags empty when no column is declared", async () => {
    const deck = await parseAnkiText(fileOf("باب\tdoor"));

    expect(deck.cards[0].tags).toEqual([]);
  });
});

describe("size and shape", () => {
  it("reports how many notes the file held", async () => {
    const deck = await parseAnkiText(fileOf("باب\tdoor\nكتاب\tbook\nhello\tworld"));

    // Counted before the Arabic filter, so an admin can see that a third of
    // the file was skipped.
    expect(deck.totalNotes).toBe(3);
    expect(deck.cards).toHaveLength(2);
  });

  it("imports a deck at the limit without flagging it", async () => {
    const rows = Array.from({ length: ANKI_IMPORT_LIMIT }, (_, i) => `كلمة${i}\tword ${i}`);

    const deck = await parseAnkiText(fileOf(rows.join("\n")));

    expect(deck.truncated).toBe(false);
    expect(deck.cards).toHaveLength(ANKI_IMPORT_LIMIT);
  });

  it("truncates a deck past the limit and says so", async () => {
    const rows = Array.from({ length: ANKI_IMPORT_LIMIT + 50 }, (_, i) => `كلمة${i}\tword ${i}`);

    const deck = await parseAnkiText(fileOf(rows.join("\n")));

    // Silently importing 20,000 cards would bury the learner's own deck; the
    // flag is what lets the UI say what happened.
    expect(deck.truncated).toBe(true);
    expect(deck.cards).toHaveLength(ANKI_IMPORT_LIMIT);
    expect(deck.totalNotes).toBe(ANKI_IMPORT_LIMIT + 50);
  });

  it("returns an empty deck for an empty file", async () => {
    const deck = await parseAnkiText(fileOf(""));

    expect(deck.cards).toEqual([]);
    expect(deck.truncated).toBe(false);
  });

  it("returns an empty deck for a file that is only directives", async () => {
    const deck = await parseAnkiText(fileOf("#separator:tab\n#html:true"));

    expect(deck.cards).toEqual([]);
  });

  it("ignores blank lines between rows", async () => {
    const deck = await parseAnkiText(fileOf("باب\tdoor\n\n\nكتاب\tbook\n"));

    expect(deck.cards).toHaveLength(2);
  });

  it("handles Windows line endings", async () => {
    const deck = await parseAnkiText(fileOf("#separator:tab\r\nباب\tdoor\r\nكتاب\tbook"));

    // Anki on Windows writes CRLF, and a stray \r on the end of a field would
    // stop the headword matching anything.
    expect(deck.cards).toHaveLength(2);
    expect(deck.cards[1].wordEnglish).toBe("book");
  });

  it("carries no media for a text import", async () => {
    const deck = await parseAnkiText(fileOf("باب\tdoor"));

    // Images and audio only travel in an .apkg; a text export references files
    // that were never included.
    expect(deck.media.size).toBe(0);
    expect(deck.cards[0].imageRefs).toEqual([]);
    expect(deck.cards[0].audioRefs).toEqual([]);
  });
});
