import { expect, test } from "./support/fixtures";
import * as XLSX from "xlsx";
import type { Page } from "@playwright/test";

/**
 * Importing a lesson plan from a spreadsheet.
 *
 * Curriculum content is authored in Excel and enters the database through this
 * one page. `parseLessonXlsx` and `useLessonImport` have their own unit tests;
 * what those cannot see is the seam between them — that the file the admin
 * picked is the buffer that gets parsed, that the review table shows what will
 * actually be written, and that the write is the parsed plan rather than a
 * subset of it.
 *
 * The parser is deliberately forgiving: it matches sheets by partial name and
 * skips rows it does not recognise. That is what makes the review step
 * load-bearing — a shifted column produces a lesson that imports cleanly and is
 * simply missing half its words, and the table is the only place anyone would
 * notice before it reaches a learner.
 */

type Cell = string | number | null;

/** Build an xlsx file from named sheets of raw rows. */
function workbook(sheets: Record<string, Cell[][]>): Buffer {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const OVERVIEW: Cell[][] = [
  ["HAKIYA  |  Stage 1 · Lesson 4 · Around the House", null],
  ["Stage", "Stage 1 — Foundations (Pre-A1 → A1)"],
  ["Lesson", "Lesson 4 of 20  |  Week 2, Day 1"],
  ["Duration", "~15 minutes"],
  ["CEFR Target", "A1"],
  ["Approach", "Immersion-first"],
  ["Unlock condition", "Finish Lesson 3"],
];

const VOCAB: Cell[][] = [
  ["📖 VOCABULARY", null],
  ["#", "Arabic", "Transliteration", "English", "Category", "Image scene", "Teaching note"],
  [1, "باب", "baab", "door", "objects", "a wooden door", "emphatic b"],
  [2, "كتاب", "kitaab", "book", "objects", "an open book", ""],
  [3, "كرسي", "kursi", "chair", "objects", "a wooden chair", ""],
];

/** A complete, well-formed lesson plan as an author would produce it. */
const aLessonPlan = (over: Record<string, Cell[][]> = {}): Buffer =>
  workbook({
    "📋 Lesson Overview": OVERVIEW,
    "📖 Vocabulary": VOCAB,
    "🗺️ Lesson Sequence": [
      ["🗺️ LESSON SEQUENCE", null],
      ["#", "Step", "Minutes"],
      [1, "Warm-up", "2"],
      [2, "New words", "8"],
    ],
    ...over,
  });

/** The hidden file input the upload button clicks through to. */
async function pickFile(page: Page, bytes: Buffer, name = "lesson-4.xlsx") {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: bytes,
  });
}

const reviewRows = (page: Page) => page.locator("tbody tr");

/** A zip header with nothing behind it — what a truncated download looks like. */
const TRUNCATED_XLSX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("this download did not finish"),
]);

test.beforeEach(async ({ signInAs }) => {
  await signInAs("admin");
});

test.describe("picking a file", () => {
  test("offers the upload before anything is chosen", async ({ page }) => {
    await page.goto("/admin/lessons/import");

    await expect(page.getByRole("heading", { name: "Import Lesson Plan" })).toBeVisible();
    await expect(page.getByText("Click to select xlsx file")).toBeVisible();
    // Step 2 is the review, and there is nothing to review yet.
    await expect(page.getByText("Step 2: Review Parsed Data")).toHaveCount(0);
  });

  test("names the file it parsed", async ({ page }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());

    // The prompt is replaced by the filename, which is the only confirmation
    // that the right file was picked from a folder of near-identical ones.
    await expect(page.getByText("lesson-4.xlsx")).toBeVisible();
  });

  test("says how many words it found", async ({ page }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());

    await expect(page.getByText("Found 3 vocabulary words.")).toBeVisible();
  });

  test("reports a file that is not a spreadsheet at all as parsed", async ({ page }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, Buffer.from("these are just some notes I typed"), "notes.xlsx");

    // Pinned, not fixed. SheetJS sniffs the format and falls back to reading
    // anything it cannot recognise as delimited text, so `XLSX.read` never
    // throws — a PDF, a CSV or a plain text file all come back as a workbook
    // with one sheet. The page reports success, offers a lesson titled
    // "Untitled Lesson" with no words, and the Import button is live. Nothing
    // between here and the database says the admin picked the wrong file.
    await expect(page.getByText("File parsed successfully")).toBeVisible();
    await expect(page.getByText("Found 0 vocabulary words.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import Lesson (0 words)" })).toBeEnabled();
  });

  test("keeps the review off screen when a reparse fails", async ({ page, expectConsoleErrors }) => {
    // The page logs the parse failure it is about to toast.
    expectConsoleErrors([/Parse error/]);
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
    await expect(page.getByText("Step 2: Review Parsed Data")).toBeVisible();

    // A file that claims to be a zip and is not — a truncated download, say —
    // is one of the few inputs SheetJS actually refuses. An empty file is not:
    // it comes back as a workbook with one empty sheet.
    await pickFile(page, TRUNCATED_XLSX, "broken.xlsx");

    // A failed pick must clear the previous plan, or Import would write a
    // lesson the admin is no longer looking at.
    await expect(page.getByText("Failed to parse file")).toBeVisible();
    await expect(page.getByText("Step 2: Review Parsed Data")).toHaveCount(0);
  });

  test("lets the same file be picked twice", async ({ page }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
    await expect(reviewRows(page)).toHaveCount(3);

    // The input's value is cleared after each parse; without that, re-selecting
    // the same filename fires no change event and the page appears frozen.
    await pickFile(page, aLessonPlan({ "📖 Vocabulary": [...VOCAB, [4, "طاولة", "taawila", "table", "objects", "", ""]] }));
    await expect(reviewRows(page)).toHaveCount(4);
  });
});

test.describe("reviewing what was parsed", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
  });

  test("shows the lesson's own heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Around the House" })).toBeVisible();
  });

  test("shows the stage, lesson, duration and level it read", async ({ page }) => {
    // Four fields, four places an author's typo turns into a lesson filed under
    // the wrong stage or gated at the wrong level.
    await expect(page.getByText("Stage 1 — Foundations (Pre-A1 → A1)")).toBeVisible();
    await expect(page.getByText("Lesson 4 of 20", { exact: false })).toBeVisible();
    await expect(page.getByText("~15 minutes")).toBeVisible();
    // The CEFR value shares a cell with its label, so it is asserted through
    // the cell rather than as a standalone node.
    await expect(page.getByText("CEFR:").locator("..")).toContainText("A1");
  });

  test("lists every word with its columns in order", async ({ page }) => {
    await expect(page.locator("thead th")).toHaveText([
      "#",
      "Arabic",
      "Translit.",
      "English",
      "Category",
    ]);
    await expect(reviewRows(page)).toHaveCount(3);
    await expect(reviewRows(page).first().locator("td")).toHaveText([
      "1",
      "باب",
      "baab",
      "door",
      "objects",
    ]);
  });

  test("renders the Arabic right to left", async ({ page }) => {
    // The column is authored in Arabic and read by someone checking it against
    // the source file; rendered LTR the letters join the wrong way.
    await expect(reviewRows(page).first().locator("td").nth(1)).toHaveAttribute("dir", "rtl");
  });

  test("counts the words on the button that will write them", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Import Lesson (3 words)" })).toBeVisible();
  });
});

test.describe("a partly readable file", () => {
  test("imports a plan with no vocabulary sheet at all", async ({ page }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, workbook({ "📋 Lesson Overview": OVERVIEW }));

    // Pinned. A missing vocabulary sheet is not an error — the parser returns an
    // empty list, the toast reports "Found 0 vocabulary words", and the button
    // offers to import a lesson with nothing in it. The likeliest cause is a
    // renamed sheet, which is exactly the case a hard failure would catch.
    await expect(page.getByText("Found 0 vocabulary words.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import Lesson (0 words)" })).toBeVisible();
  });

  test("silently drops a row whose columns were shifted", async ({ page }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan({
      "📖 Vocabulary": [
        ...VOCAB,
        // No number in the first column — one inserted column upstream and
        // every row below looks like this.
        [null, "طاولة", "taawila", "table", "objects", "", ""],
      ],
    }));

    // Pinned. The row is skipped without a word anywhere on the page. Three
    // words are reported and three are written; the fourth is simply gone, and
    // the only way to notice is to count against the source file.
    await expect(page.getByText("Found 3 vocabulary words.")).toBeVisible();
    await expect(reviewRows(page)).toHaveCount(3);
  });

  test("still imports when the overview sheet is missing", async ({ page }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, workbook({ "📖 Vocabulary": VOCAB }));

    // No title, no stage, no level — the lesson lands as "Lesson 0" with three
    // words attached and nothing saying why.
    await expect(page.getByText("Found 3 vocabulary words.")).toBeVisible();
    await expect(page.getByText("Untitled")).toBeVisible();
  });
});

test.describe("importing", () => {
  test("writes the lesson with what the overview said", async ({ page, db }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
    await page.getByRole("button", { name: "Import Lesson (3 words)" }).click();

    await expect(page.getByText("Lesson imported!")).toBeVisible();
    const lesson = db.lastWriteTo("lessons")?.payload[0];
    expect(lesson).toMatchObject({
      title: "Around the House",
      lesson_number: 4,
      cefr_target: "A1",
      approach: "Immersion-first",
      unlock_condition: "Finish Lesson 3",
      duration_minutes: 15,
      status: "draft",
      dialect_module: "Gulf",
    });
  });

  test("keeps the authored sections rather than only the word list", async ({ page, db }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
    await page.getByRole("button", { name: "Import Lesson (3 words)" }).click();
    await expect(page.getByText("Lesson imported!")).toBeVisible();

    // These columns were dropped by the insert once before, and a designed
    // lesson arrived as a bare vocabulary list. Learn.tsx renders the
    // learner-facing ones.
    const lesson = db.lastWriteTo("lessons")?.payload[0] as Record<string, unknown>;
    expect(Array.isArray(lesson.lesson_sequence)).toBe(true);
    expect((lesson.lesson_sequence as unknown[]).length).toBe(2);
    for (const key of ["image_scenes", "flashcard_spec", "real_world_prompts", "design_rationale", "sound_spotlight"]) {
      expect(Array.isArray(lesson[key]), `${key} should be persisted as an array`).toBe(true);
    }
  });

  test("writes every word against the new lesson, in order", async ({ page, db }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
    await page.getByRole("button", { name: "Import Lesson (3 words)" }).click();
    await expect(page.getByText("Lesson imported!")).toBeVisible();

    const words = db.lastWriteTo("vocabulary_words")?.payload as Record<string, unknown>[];
    expect(words).toHaveLength(3);
    expect(words.map((w) => w.word_arabic)).toEqual(["باب", "كتاب", "كرسي"]);
    expect(words.map((w) => w.word_english)).toEqual(["door", "book", "chair"]);
    // The order the author wrote them in is the order they are taught in.
    expect(words.map((w) => w.display_order)).toEqual([0, 1, 2]);
  });

  test("leaves the admin on the dashboard afterwards", async ({ page }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
    await page.getByRole("button", { name: "Import Lesson (3 words)" }).click();

    await expect(page).toHaveURL(/\/admin$/);
  });

  test("says so when the lesson cannot be written", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/Import error/]);
    db.failWrites("lessons", 409, { message: "duplicate key value violates unique constraint" });

    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
    await page.getByRole("button", { name: "Import Lesson (3 words)" }).click();

    await expect(page.getByText("Import failed")).toBeVisible();
    await expect(page.getByText(/duplicate key/)).toBeVisible();
    // Still on the page, with the parsed plan intact, so it can be retried.
    await expect(page).toHaveURL(/\/admin\/lessons\/import$/);
    await expect(reviewRows(page)).toHaveCount(3);
  });

  test("leaves a lesson with no words behind when the words fail", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/Import error/]);
    db.failWrites("vocabulary_words", 400, { message: "value too long for type character varying" });

    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
    await page.getByRole("button", { name: "Import Lesson (3 words)" }).click();

    // Pinned. The two writes are not a transaction: the lesson insert has
    // already committed by the time the words are rejected, so a failed import
    // leaves an empty draft lesson in the curriculum. Retrying then trips the
    // lesson_number uniqueness and the admin cannot get past it without
    // deleting the orphan by hand.
    await expect(page.getByText("Import failed")).toBeVisible();
    expect(db.lastWriteTo("lessons")).toBeTruthy();
  });

  test("writes nothing until the button is pressed", async ({ page, db }) => {
    await page.goto("/admin/lessons/import");
    await pickFile(page, aLessonPlan());
    await expect(reviewRows(page)).toHaveCount(3);

    // Parsing is a preview. Nothing about picking a file should reach the
    // database.
    expect(db.lastWriteTo("lessons")).toBeUndefined();
    expect(db.lastWriteTo("vocabulary_words")).toBeUndefined();
  });
});

test.describe("getting in", () => {
  test("turns a plain learner away", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/admin/lessons/import");

    await expect(page.getByRole("heading", { name: "Import Lesson Plan" })).toHaveCount(0);
  });

  test("turns a content reviewer away", async ({ page, signInAs }) => {
    // The reviewer allow-list is videos, set phrases and dialect rules; writing
    // curriculum is not on it.
    await signInAs("content_reviewer");

    await page.goto("/admin/lessons/import");

    await expect(page.getByRole("heading", { name: "Import Lesson Plan" })).toHaveCount(0);
  });
});
