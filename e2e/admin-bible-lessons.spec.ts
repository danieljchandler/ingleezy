import { expect, test, type Page } from "./support/fixtures";
import { aBibleLesson, TEST_USER_ID } from "../src/test/support/factories";

/**
 * `/admin/bible-lessons` — the hand-curated passage list.
 *
 * The whole page is one form and one list, but the form does something no
 * other admin form does: it round-trips three JSONB arrays through
 * newline-separated textareas. A verse list is the unit the reader renders, so
 * how the text is split and rejoined is the behaviour worth pinning — blank
 * lines, trailing newlines and the editing round trip all have to preserve the
 * array, not the text.
 */

const LESSON = "f7f7f7f7-0000-4000-8000-000000000000";
const lessonAt = (index: number) =>
  `f7f7f7f7-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** The verse boxes, in the order the form lays them out. */
const dialectBox = (page: Page) => page.locator("textarea").nth(0);
const formalBox = (page: Page) => page.locator("textarea").nth(1);
const englishBox = (page: Page) => page.locator("textarea").nth(2);
const noteBox = (page: Page) => page.locator("textarea").nth(3);

async function openNewForm(page: Page) {
  await page.getByRole("button", { name: /new lesson/i }).click();
  await expect(page.getByRole("heading", { name: /new lesson/i })).toBeVisible();
}

test.describe("the lesson list", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("says when the dialect has nothing curated", async ({ page, db }) => {
    db.seed("bible_lessons", []);
    await page.goto("/admin/bible-lessons");

    await expect(page.getByRole("heading", { name: /bible lessons/i })).toBeVisible();
    await expect(page.getByText(/No lessons yet for Gulf/)).toBeVisible();
  });

  test("shows a lesson with its reference and verse count", async ({ page, db }) => {
    db.seed("bible_lessons", [
      aBibleLesson({
        title: "The Beatitudes",
        description: "The opening of the Sermon on the Mount.",
        book_name: "Matthew",
        chapter: 5,
        verse_start: 3,
        verse_end: 5,
        dialect_verses: ["طوبى للمساكين", "طوبى للحزانى"],
      }),
    ]);

    await page.goto("/admin/bible-lessons");

    await expect(page.getByText("The Beatitudes")).toBeVisible();
    await expect(page.getByText("The opening of the Sermon on the Mount.")).toBeVisible();
    await expect(page.getByText("Matthew 5:3–5 · 2 verses")).toBeVisible();
    await expect(page.getByText("Draft")).toBeVisible();
  });

  test("writes a single-verse reference without a range", async ({ page, db }) => {
    db.seed("bible_lessons", [
      aBibleLesson({ book_name: "John", chapter: 3, verse_start: 16, verse_end: 16 }),
    ]);

    await page.goto("/admin/bible-lessons");

    await expect(page.getByText("John 3:16 · 2 verses")).toBeVisible();
  });

  test("shows only the active dialect, and follows the switcher", async ({ page, db }) => {
    db.seed("bible_lessons", [
      aBibleLesson({ id: lessonAt(0), title: "Gulf passage", dialect: "Gulf" }),
      aBibleLesson({ id: lessonAt(1), title: "Cairo passage", dialect: "Egyptian" }),
    ]);

    await page.goto("/admin/bible-lessons");
    await expect(page.getByText("Gulf passage")).toBeVisible();
    await expect(page.getByText("Cairo passage")).toHaveCount(0);

    await page.getByRole("button", { name: /Egyptian Arabic/ }).click();

    await expect(page.getByText("Cairo passage")).toBeVisible();
    await expect(page.getByText(/Hand-curated Bible passages in Egyptian Arabic/)).toBeVisible();
  });

  test("orders by the hand-set running order", async ({ page, db }) => {
    db.seed("bible_lessons", [
      aBibleLesson({ id: lessonAt(0), title: "Second", display_order: 2 }),
      aBibleLesson({ id: lessonAt(1), title: "First", display_order: 1 }),
    ]);

    await page.goto("/admin/bible-lessons");

    const titles = page.locator("h3.font-semibold");
    await expect(titles.first()).toHaveText("First");
    await expect(titles.last()).toHaveText("Second");
  });

  test("reports a failed load rather than an empty shelf", async ({ page, db }) => {
    db.seed("bible_lessons", [aBibleLesson()]);
    db.failAlways("bible_lessons", 500);

    await page.goto("/admin/bible-lessons");

    await expect(page.getByText(/failed to load lessons/i)).toBeVisible();
  });

  test("publishes from the list", async ({ page, db }) => {
    db.seed("bible_lessons", [aBibleLesson({ id: LESSON, published: false })]);
    await page.goto("/admin/bible-lessons");

    await page.getByRole("switch").click();

    await expect(page.getByText("Published")).toBeVisible();
    expect(db.lastWriteTo("bible_lessons")).toMatchObject({ method: "PATCH" });
    expect(db.lastWriteTo("bible_lessons")?.payload[0]).toEqual({ published: true });
  });

  test("takes a published lesson back down", async ({ page, db }) => {
    db.seed("bible_lessons", [aBibleLesson({ id: LESSON, published: true })]);
    await page.goto("/admin/bible-lessons");

    await page.getByRole("switch").click();

    await expect(page.getByText("Draft")).toBeVisible();
    expect(db.rows("bible_lessons")[0]).toMatchObject({ published: false });
  });

  test("says so when the publish toggle is rejected", async ({ page, db }) => {
    db.seed("bible_lessons", [aBibleLesson({ id: LESSON, published: false })]);
    await page.goto("/admin/bible-lessons");

    db.failWrites("bible_lessons", 403);
    await page.getByRole("switch").click();

    await expect(page.getByText(/update failed/i)).toBeVisible();
    expect(db.rows("bible_lessons")[0]).toMatchObject({ published: false });
  });

  test("asks before deleting", async ({ page, db }) => {
    db.seed("bible_lessons", [aBibleLesson({ id: LESSON, title: "The Beatitudes" })]);
    let asked = "";
    page.on("dialog", (dialog) => {
      asked = dialog.message();
      return dialog.dismiss();
    });
    await page.goto("/admin/bible-lessons");

    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect.poll(() => asked).toContain("cannot be undone");
    expect(db.writesTo("bible_lessons")).toHaveLength(0);
  });

  test("deletes once confirmed", async ({ page, db }) => {
    db.seed("bible_lessons", [aBibleLesson({ id: LESSON })]);
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/bible-lessons");

    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByText(/lesson deleted/i)).toBeVisible();
    expect(db.rows("bible_lessons")).toHaveLength(0);
  });

  test("reports a rejected delete", async ({ page, db }) => {
    db.seed("bible_lessons", [aBibleLesson({ id: LESSON })]);
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/bible-lessons");

    db.failWrites("bible_lessons", 403);
    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByText(/delete failed/i)).toBeVisible();
    expect(db.rows("bible_lessons")).toHaveLength(1);
  });
});

test.describe("creating a lesson", () => {
  test.beforeEach(async ({ signInAs, db, page }) => {
    await signInAs("admin");
    db.seed("bible_lessons", []);
    await page.goto("/admin/bible-lessons");
  });

  test("hides the new-lesson button while the form is open", async ({ page }) => {
    await openNewForm(page);

    await expect(page.getByRole("button", { name: /new lesson/i })).toHaveCount(0);
  });

  test("will not save without a title", async ({ page, db }) => {
    await openNewForm(page);

    await dialectBox(page).fill("طوبى للمساكين");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/title is required/i)).toBeVisible();
    expect(db.writesTo("bible_lessons")).toHaveLength(0);
  });

  test("will not save without at least one dialect verse", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/one verse in dialect Arabic/i)).toBeVisible();
    expect(db.writesTo("bible_lessons")).toHaveLength(0);
  });

  test("treats a box of only whitespace as no verses", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await dialectBox(page).fill("   \n\n  \n");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/one verse in dialect Arabic/i)).toBeVisible();
    expect(db.writesTo("bible_lessons")).toHaveLength(0);
  });

  test("saves each line as its own verse", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await dialectBox(page).fill("طوبى للمساكين\n\nطوبى للحزانى\n");
    await formalBox(page).fill("طُوبَى لِلْمَسَاكِين");
    await englishBox(page).fill("Blessed are the poor\nBlessed are those who mourn");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/lesson created/i)).toBeVisible();
    const write = db.lastWriteTo("bible_lessons");
    expect(write?.method).toBe("POST");
    // Blank lines are dropped and each remaining line is trimmed, so the array
    // is the same length the reader will page through.
    expect(write?.payload[0]).toMatchObject({
      title: "The Beatitudes",
      dialect: "Gulf",
      dialect_verses: ["طوبى للمساكين", "طوبى للحزانى"],
      formal_verses: ["طُوبَى لِلْمَسَاكِين"],
      english_verses: ["Blessed are the poor", "Blessed are those who mourn"],
      published: false,
      created_by: TEST_USER_ID,
    });
  });

  test("stores an empty optional column as an empty array, not null", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await dialectBox(page).fill("طوبى للمساكين");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/lesson created/i)).toBeVisible();
    expect(db.lastWriteTo("bible_lessons")?.payload[0]).toMatchObject({
      formal_verses: [],
      english_verses: [],
    });
  });

  test("stores a blank description and note as null", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await page.getByPlaceholder(/Short blurb/).fill("   ");
    await dialectBox(page).fill("طوبى للمساكين");
    await noteBox(page).fill("  ");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/lesson created/i)).toBeVisible();
    expect(db.lastWriteTo("bible_lessons")?.payload[0]).toMatchObject({
      description: null,
      cultural_note: null,
    });
  });

  test("saves the book's name alongside its code", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /^John/ }).click();
    await page.getByPlaceholder(/The Beatitudes/).fill("For God so loved");
    await dialectBox(page).fill("لأنه هكذا أحب الله");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/lesson created/i)).toBeVisible();
    // Both, because the reader shows the name and the Bolls API needs the code.
    expect(db.lastWriteTo("bible_lessons")?.payload[0]).toMatchObject({
      book_usfm: "JHN",
      book_name: "John",
    });
  });

  test("floors a fractional chapter or verse to a whole one", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await dialectBox(page).fill("طوبى للمساكين");
    await page.locator('input[type="number"]').nth(0).fill("5.7");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/lesson created/i)).toBeVisible();
    expect(db.lastWriteTo("bible_lessons")?.payload[0]).toMatchObject({ chapter: 5 });
  });

  test("floors a chapter below one up to one", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await dialectBox(page).fill("طوبى للمساكين");
    await page.locator('input[type="number"]').nth(0).fill("0");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/lesson created/i)).toBeVisible();
    expect(db.lastWriteTo("bible_lessons")?.payload[0]).toMatchObject({ chapter: 1 });
  });

  test("accepts a verse range that runs backwards", async ({ page, db }) => {
    // Pinned, not fixed. Start and end are clamped independently and never
    // compared, so 9–3 saves and renders as "Matthew 5:9–3".
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await dialectBox(page).fill("طوبى للمساكين");
    await page.locator('input[type="number"]').nth(1).fill("9");
    await page.locator('input[type="number"]').nth(2).fill("3");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/lesson created/i)).toBeVisible();
    expect(db.lastWriteTo("bible_lessons")?.payload[0]).toMatchObject({
      verse_start: 9,
      verse_end: 3,
    });
  });

  test("saves a lesson straight to published when asked", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await dialectBox(page).fill("طوبى للمساكين");
    await page.getByRole("switch").click();
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/lesson created/i)).toBeVisible();
    expect(db.lastWriteTo("bible_lessons")?.payload[0]).toMatchObject({ published: true });
  });

  test("closes and clears the form after a save", async ({ page }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await dialectBox(page).fill("طوبى للمساكين");
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/lesson created/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /new lesson/i })).toBeVisible();

    await openNewForm(page);
    await expect(page.getByPlaceholder(/The Beatitudes/)).toHaveValue("");
  });

  test("keeps the form open when the save is rejected", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await dialectBox(page).fill("طوبى للمساكين");
    db.failWrites("bible_lessons", 403);
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page.getByText(/save failed/i)).toBeVisible();
    await expect(page.getByPlaceholder(/The Beatitudes/)).toHaveValue("The Beatitudes");
  });

  test("cancelling discards the draft entirely", async ({ page, db }) => {
    await openNewForm(page);

    await page.getByPlaceholder(/The Beatitudes/).fill("The Beatitudes");
    await page.getByRole("button", { name: /cancel/i }).click();

    expect(db.writesTo("bible_lessons")).toHaveLength(0);
    await openNewForm(page);
    await expect(page.getByPlaceholder(/The Beatitudes/)).toHaveValue("");
  });
});

test.describe("editing a lesson", () => {
  test.beforeEach(async ({ signInAs, db, page }) => {
    await signInAs("admin");
    db.seed("bible_lessons", [
      aBibleLesson({
        id: LESSON,
        title: "The Beatitudes",
        description: "The Sermon on the Mount.",
        book_usfm: "MAT",
        book_name: "Matthew",
        chapter: 5,
        verse_start: 3,
        verse_end: 5,
        dialect_verses: ["طوبى للمساكين", "طوبى للحزانى"],
        formal_verses: ["طُوبَى"],
        english_verses: ["Blessed are the poor"],
        cultural_note: "Read at Easter.",
        display_order: 2,
        published: true,
      }),
    ]);
    await page.goto("/admin/bible-lessons");
    await page.locator("button:has(svg.lucide-pencil)").click();
  });

  test("joins the verse arrays back into their boxes", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /edit lesson/i })).toBeVisible();
    await expect(page.getByPlaceholder(/The Beatitudes/)).toHaveValue("The Beatitudes");
    await expect(page.getByPlaceholder(/Short blurb/)).toHaveValue("The Sermon on the Mount.");
    // One verse per line, exactly as it was split.
    await expect(dialectBox(page)).toHaveValue("طوبى للمساكين\nطوبى للحزانى");
    await expect(formalBox(page)).toHaveValue("طُوبَى");
    await expect(englishBox(page)).toHaveValue("Blessed are the poor");
    await expect(noteBox(page)).toHaveValue("Read at Easter.");
  });

  test("patches rather than inserting", async ({ page, db }) => {
    await dialectBox(page).fill("طوبى للمساكين\nطوبى للحزانى\nطوبى للودعاء");
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/lesson updated/i)).toBeVisible();
    const write = db.lastWriteTo("bible_lessons");
    expect(write?.method).toBe("PATCH");
    expect(write?.payload[0]).toMatchObject({
      dialect_verses: ["طوبى للمساكين", "طوبى للحزانى", "طوبى للودعاء"],
    });
    expect(db.rows("bible_lessons")).toHaveLength(1);
  });

  test("keeps the running order and publish state it was given", async ({ page, db }) => {
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/lesson updated/i)).toBeVisible();
    expect(db.lastWriteTo("bible_lessons")?.payload[0]).toMatchObject({
      display_order: 2,
      published: true,
    });
  });

  test("cancelling leaves the lesson untouched", async ({ page, db }) => {
    await page.getByPlaceholder(/The Beatitudes/).fill("Something else");
    await page.getByRole("button", { name: /cancel/i }).click();

    expect(db.writesTo("bible_lessons")).toHaveLength(0);
    await expect(page.getByText("The Beatitudes")).toBeVisible();
  });

  test("editing a second lesson replaces the first draft", async ({ page, db }) => {
    db.seed("bible_lessons", [
      aBibleLesson({ id: lessonAt(0), title: "First", display_order: 1 }),
      aBibleLesson({ id: lessonAt(1), title: "Second", display_order: 2 }),
    ]);
    await page.reload();

    await page.locator("button:has(svg.lucide-pencil)").first().click();
    await expect(page.getByPlaceholder(/The Beatitudes/)).toHaveValue("First");

    await page.getByRole("button", { name: /cancel/i }).click();
    await page.locator("button:has(svg.lucide-pencil)").last().click();

    await expect(page.getByPlaceholder(/The Beatitudes/)).toHaveValue("Second");
  });
});

test.describe("who can open it", () => {
  test.beforeEach(async ({ db }) => {
    db.seed("bible_lessons", []);
  });

  test("a recorder may curate", async ({ page, signInAs }) => {
    await signInAs("recorder");
    await page.goto("/admin/bible-lessons");

    await expect(page.getByRole("heading", { name: /bible lessons/i })).toBeVisible();
  });

  test("a content reviewer is turned away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");
    await page.goto("/admin/bible-lessons");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(/access denied/i)).toBeVisible();
  });

  test("a signed-in learner is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/admin/bible-lessons");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
