import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseLessonXlsx } from "./parseLessonXlsx";

/**
 * The lesson-plan spreadsheet importer.
 *
 * Curriculum content is authored in Excel and lands in the database through
 * this one function, so every mistake it makes becomes a lesson a learner is
 * taught. The failure mode is quiet by construction: the parser skips anything
 * it does not recognise, so a shifted column or a renamed sheet produces a
 * lesson that imports cleanly and is simply missing half its words.
 *
 * The sheets are keyed by *partial* name because the real files carry emoji
 * prefixes ("📖 Vocabulary"), and the vocabulary sheet is not a table but three
 * stacked sections separated by marker rows. Both are worth pinning: they are
 * the parts an author can break without touching anything that looks like data.
 */

type Cell = string | number | null;

/** Build a workbook from named sheets of raw rows. */
function workbook(sheets: Record<string, Cell[][]>): ArrayBuffer {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const OVERVIEW_ROWS: Cell[][] = [
  ["HAKIYA  |  Stage 1 · Lesson 1 · Objects — The World Around You", null],
  ["Stage", "Stage 1 — Foundations (Pre-A1 → A1)"],
  ["Lesson", "Lesson 3 of 20  |  Week 1, Day 1"],
  ["Duration", "~15 minutes"],
  ["CEFR Target", "A1"],
  ["Approach", "Immersion-first"],
  ["Vocab introduced", "12 words"],
  ["Grammar", "Definite article"],
  ["Content type", "Objects"],
  ["Output expected", "Name five objects aloud"],
  ["Unlock condition", "Finish Lesson 2"],
];

const VOCAB_ROWS: Cell[][] = [
  ["📖 VOCABULARY", null],
  ["#", "Arabic", "Transliteration", "English", "Category", "Image scene", "Teaching note"],
  [1, "باب", "baab", "door", "objects", "a wooden door", "emphatic b"],
  [2, "كتاب", "kitaab", "book", "objects", "an open book", ""],
  ["SOUND SPOTLIGHT", null],
  ["ق", null, "قلم", "a hard k made further back in the throat"],
  ["DESIGN RATIONALE", null],
  ["Concrete first", "Objects are picturable, so no English is needed."],
];

/** The whole file, as an author would produce it. */
const FULL_FILE = () =>
  workbook({
    "📋 Lesson Overview": OVERVIEW_ROWS,
    "📖 Vocabulary": VOCAB_ROWS,
    "🗺️ Lesson Sequence": [
      ["🗺️ LESSON SEQUENCE", null],
      ["#", "Step", "Minutes"],
      [1, "Warm-up", "2"],
      [2, "New words", "8"],
    ],
    "🖼️ Image Scenes": [
      ["#", "Word", "Scene"],
      [1, "باب", "a wooden door in a courtyard"],
    ],
    "🃏 Flashcard Spec": [
      ["#", "Front", "Back"],
      [1, "باب", "door"],
    ],
    "💬 Real-World Prompts": [
      ["#", "Prompt"],
      [1, "Name three objects in your room in Arabic."],
    ],
  });

describe("the lesson overview", () => {
  it("reads each labelled field", () => {
    const { overview } = parseLessonXlsx(FULL_FILE());

    expect(overview.stageLabel).toBe("Stage 1 — Foundations (Pre-A1 → A1)");
    expect(overview.cefrTarget).toBe("A1");
    expect(overview.grammar).toBe("Definite article");
    expect(overview.unlockCondition).toBe("Finish Lesson 2");
  });

  it("takes the lesson number from the label rather than the row order", () => {
    const { overview } = parseLessonXlsx(FULL_FILE());

    // "Lesson 3 of 20" — the number decides where the lesson sits in the
    // curriculum, so reading "20" or defaulting to 1 would file it wrongly.
    expect(overview.lessonNumber).toBe(3);
  });

  it("takes the minutes out of a human duration", () => {
    const { overview } = parseLessonXlsx(FULL_FILE());

    expect(overview.duration).toBe("~15 minutes");
    expect(overview.durationMinutes).toBe(15);
  });

  it("falls back to fifteen minutes when the duration has no number", () => {
    const file = workbook({
      "📋 Lesson Overview": [["Duration", "about a quarter of an hour"]],
    });

    // The column is NOT NULL; importing NaN would fail the insert with a
    // message about a number, which tells the author nothing about the cell.
    expect(parseLessonXlsx(file).overview.durationMinutes).toBe(15);
  });

  it("takes the title from the branded header", () => {
    const { overview } = parseLessonXlsx(FULL_FILE());

    // "HAKIYA | Stage 1 · Lesson 1 · Objects — The World Around You" — the
    // title is everything after the second separator.
    expect(overview.title).toBe("Objects — The World Around You");
  });

  it("keeps a title containing its own separator intact", () => {
    const file = workbook({
      "📋 Lesson Overview": [["HAKIYA | Stage 1 · Lesson 1 · Food · Drink", null]],
    });

    // Splitting on "·" and taking one part would truncate this to "Food".
    expect(parseLessonXlsx(file).overview.title).toBe("Food · Drink");
  });

  it("falls back to the whole header when it is not in the expected shape", () => {
    const file = workbook({
      "📋 Lesson Overview": [["HAKIYA — Lesson notes", null]],
    });

    expect(parseLessonXlsx(file).overview.title).toBe("HAKIYA — Lesson notes");
  });

  it("names an untitled lesson rather than importing a blank", () => {
    const file = workbook({ "📖 Vocabulary": VOCAB_ROWS });

    // A lesson with no title is unfindable in the admin list.
    expect(parseLessonXlsx(file).overview.title).toBe("Untitled Lesson");
  });
});

describe("the vocabulary sheet", () => {
  it("reads every column of each word", () => {
    const { vocabulary } = parseLessonXlsx(FULL_FILE());

    expect(vocabulary).toHaveLength(2);
    expect(vocabulary[0]).toEqual({
      number: 1,
      arabic: "باب",
      transliteration: "baab",
      english: "door",
      category: "objects",
      imageScene: "a wooden door",
      teachingNote: "emphatic b",
    });
  });

  it("leaves an empty optional cell as an empty string", () => {
    const { vocabulary } = parseLessonXlsx(FULL_FILE());

    // Not undefined and not "null": these go straight into text columns.
    expect(vocabulary[1].teachingNote).toBe("");
  });

  it("stops treating rows as vocabulary at the sound-spotlight marker", () => {
    const { vocabulary, soundSpotlight } = parseLessonXlsx(FULL_FILE());

    // The three sections are stacked in one sheet with marker rows between
    // them. Missing a marker would import a pronunciation note as a word.
    expect(vocabulary.map((word) => word.arabic)).toEqual(["باب", "كتاب"]);
    expect(soundSpotlight).toEqual([
      { sound: "ق", example: "قلم", explanation: "a hard k made further back in the throat" },
    ]);
  });

  it("reads the design rationale as its own section", () => {
    const { designRationale } = parseLessonXlsx(FULL_FILE());

    expect(designRationale).toEqual([
      { principle: "Concrete first", explanation: "Objects are picturable, so no English is needed." },
    ]);
  });

  it("skips a row with no number, silently", () => {
    const file = workbook({
      "📖 Vocabulary": [
        ["#", "Arabic", "Transliteration", "English"],
        [1, "باب", "baab", "door"],
        // An author who deletes a row and forgets to renumber leaves this.
        ["", "كتاب", "kitaab", "book"],
        [3, "قلم", "qalam", "pen"],
      ],
    });

    const { vocabulary } = parseLessonXlsx(file);

    // Recording current behaviour, and the sharpest edge in the parser: the
    // word is dropped with no error anywhere. The lesson imports, the admin
    // sees a success toast, and one word is simply missing. Worth knowing
    // before an author asks why their lesson is short.
    expect(vocabulary.map((word) => word.arabic)).toEqual(["باب", "قلم"]);
  });

  it("skips a numbered row with no Arabic", () => {
    const file = workbook({
      "📖 Vocabulary": [
        ["#", "Arabic", "Transliteration", "English"],
        [1, "", "", "door"],
        [2, "كتاب", "kitaab", "book"],
      ],
    });

    // A word with no Arabic is not a word; importing it would put a blank
    // flashcard into a learner's deck.
    expect(parseLessonXlsx(file).vocabulary.map((word) => word.arabic)).toEqual(["كتاب"]);
  });

  it("returns nothing rather than throwing when the sheet is missing", () => {
    const file = workbook({ "📋 Lesson Overview": OVERVIEW_ROWS });
    const plan = parseLessonXlsx(file);

    expect(plan.vocabulary).toEqual([]);
    expect(plan.soundSpotlight).toEqual([]);
    expect(plan.designRationale).toEqual([]);
  });
});

describe("the lesson-plan sheets", () => {
  it("reads a table under its header row", () => {
    const { lessonSequence } = parseLessonXlsx(FULL_FILE());

    expect(lessonSequence).toEqual([
      { "#": "1", Step: "Warm-up", Minutes: "2" },
      { "#": "2", Step: "New words", Minutes: "8" },
    ]);
  });

  it("reads each of the four plan sheets", () => {
    const plan = parseLessonXlsx(FULL_FILE());

    // All four were parsed correctly and then dropped at insert for a long
    // time, so a designed lesson reached the learner as a bare word list.
    expect(plan.imageScenes).toHaveLength(1);
    expect(plan.flashcardSpec).toHaveLength(1);
    expect(plan.realWorldPrompts).toHaveLength(1);
    expect(plan.lessonSequence).toHaveLength(2);
  });

  it("ignores a blank row inside a table", () => {
    const file = workbook({
      "🗺️ Lesson Sequence": [
        ["#", "Step"],
        [1, "Warm-up"],
        [null, null],
        [2, "New words"],
      ],
    });

    expect(parseLessonXlsx(file).lessonSequence).toHaveLength(2);
  });

  it("falls back to positional columns when there is no header row", () => {
    const file = workbook({
      "💬 Real-World Prompts": [
        ["Ask a shopkeeper the price of something.", "In person"],
        ["Label three things in your kitchen.", "At home"],
      ],
    });

    // Authors do not always include the "#" header. Losing the sheet entirely
    // would be worse than losing the column names.
    expect(parseLessonXlsx(file).realWorldPrompts).toEqual([
      { col_0: "Ask a shopkeeper the price of something.", col_1: "In person" },
      { col_0: "Label three things in your kitchen.", col_1: "At home" },
    ]);
  });

  it("drops the decorative banner from a header-less sheet", () => {
    const file = workbook({
      "💬 Real-World Prompts": [
        ["💬 REAL-WORLD PROMPTS", null],
        ["Ask a shopkeeper the price of something.", null],
      ],
    });

    // The banner row is styling, not data; importing it would show up as a
    // prompt telling the learner to do nothing.
    expect(parseLessonXlsx(file).realWorldPrompts).toEqual([
      { col_0: "Ask a shopkeeper the price of something." },
    ]);
  });
});

describe("finding the sheets", () => {
  it("matches a sheet by part of its name, so emoji prefixes are fine", () => {
    const plan = parseLessonXlsx(FULL_FILE());

    // Every real file is authored with emoji in the tab names; an exact-name
    // lookup would find nothing at all.
    expect(plan.vocabulary).toHaveLength(2);
    expect(plan.overview.cefrTarget).toBe("A1");
  });

  it("accepts the shorter sheet names as a fallback", () => {
    const file = workbook({
      Overview: OVERVIEW_ROWS,
      Sequence: [
        ["#", "Step"],
        [1, "Warm-up"],
      ],
    });

    const plan = parseLessonXlsx(file);
    expect(plan.overview.cefrTarget).toBe("A1");
    expect(plan.lessonSequence).toHaveLength(1);
  });

  it("returns an empty plan for a workbook with none of the expected sheets", () => {
    const file = workbook({ "Some other tab": [["a", "b"]] });
    const plan = parseLessonXlsx(file);

    // A wrong file is an author mistake, and the import page can only say so
    // if this returns rather than throwing.
    expect(plan.vocabulary).toEqual([]);
    expect(plan.lessonSequence).toEqual([]);
    expect(plan.overview.title).toBe("Untitled Lesson");
  });
});
