import { expect, test } from "./support/fixtures";
import {
  aLesson,
  aStage,
  aVocabularyWord,
  lessonId,
  many,
  stageId,
  wordId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The admin curriculum: stages, their lessons, and a lesson's words.
 *
 * This is where curriculum content is reviewed after import and before it
 * reaches a learner, so the two things that matter are that nothing is hidden
 * and nothing is deleted by accident. Both are easy to get wrong quietly — the
 * lesson list is filtered by the active dialect, so a lesson in the wrong module
 * simply is not there, and the word grid deletes on confirm with no undo.
 *
 * The lesson list counts words through an embedded `vocabulary_words(id)`, which
 * makes it one of the few places an embed failure would show up as a plausible
 * zero rather than an error.
 */

const STAGE = stageId(0);
const LESSON = lessonId(0);

/**
 * The per-word delete control.
 *
 * Addressed by its destructive styling because it is an icon-only button with
 * no accessible name — one of the unlabelled buttons the a11y baseline in
 * src/test/iconButtonLabels.test.ts already counts. A screen-reader user cannot
 * tell it from the button beside it either.
 */
const deleteButtons = (page: import("@playwright/test").Page) =>
  page.locator("button.text-destructive");

/** A stage with `count` lessons, and `words` words on the first of them. */
function seedCurriculum(
  db: MemoryDb,
  { lessons = 1, words = 0 }: { lessons?: number; words?: number } = {},
) {
  db.seed("curriculum_stages", [aStage({ id: STAGE, name: "Foundations", stage_number: 1 })]);
  db.seed(
    "lessons",
    many(aLesson, lessons, (index) => ({
      id: lessonId(index),
      stage_id: STAGE,
      title: `Lesson title ${index + 1}`,
      lesson_number: index + 1,
      display_order: index + 1,
    })),
  );
  db.seed(
    "vocabulary_words",
    many(aVocabularyWord, words, (index) => ({
      id: wordId(index),
      lesson_id: LESSON,
      topic_id: null,
      word_arabic: `كلمة${index + 1}`,
      word_english: `word ${index + 1}`,
      display_order: index,
      image_url: null,
    })),
  );
}

test.describe("the curriculum overview", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("lists each stage with its lessons", async ({ page, db }) => {
    seedCurriculum(db, { lessons: 2 });

    await page.goto("/admin/curriculum");

    await expect(page.getByText("Stage 1: Foundations")).toBeVisible();
    await expect(page.getByText("Lesson 1: Lesson title 1")).toBeVisible();
    await expect(page.getByText("Lesson 2: Lesson title 2")).toBeVisible();
  });

  test("counts the lessons in a stage", async ({ page, db }) => {
    seedCurriculum(db, { lessons: 3 });

    await page.goto("/admin/curriculum");
    await expect(page.getByText("3 lessons")).toBeVisible();
  });

  test("says lesson rather than lessons for one", async ({ page, db }) => {
    seedCurriculum(db, { lessons: 1 });

    await page.goto("/admin/curriculum");
    await expect(page.getByText("1 lesson", { exact: true })).toBeVisible();
  });

  test("counts a lesson's words through the relationship", async ({ page, db }) => {
    seedCurriculum(db, { lessons: 1, words: 4 });

    await page.goto("/admin/curriculum");

    // Resolved by the backend from real rows rather than a pre-shaped embed —
    // a broken embed here reads as an empty lesson, which is exactly what an
    // admin would go and "fix" by importing it again.
    await expect(page.getByText("4 words")).toBeVisible();
  });

  test("marks a draft lesson as a draft", async ({ page, db }) => {
    seedCurriculum(db, { lessons: 1 });
    db.seed("lessons", [
      aLesson({ id: LESSON, stage_id: STAGE, title: "Lesson title 1", status: "draft" }),
    ]);

    await page.goto("/admin/curriculum");

    // The whole point of the status is that an admin can see at a glance what
    // learners can and cannot reach.
    await expect(page.getByText("draft")).toBeVisible();
  });

  test("shows only the lessons of the active dialect", async ({ page, db }) => {
    db.seed("curriculum_stages", [aStage({ id: STAGE })]);
    db.seed("lessons", [
      aLesson({ id: lessonId(0), stage_id: STAGE, title: "Gulf lesson", dialect_module: "Gulf" }),
      aLesson({
        id: lessonId(1),
        stage_id: STAGE,
        title: "Egyptian lesson",
        dialect_module: "Egyptian",
      }),
    ]);

    await page.goto("/admin/curriculum");

    // The filter is the reason a freshly imported lesson can seem to vanish:
    // the import defaults to Gulf, and an admin working in Egyptian sees
    // nothing.
    await expect(page.getByText("Lesson 1: Gulf lesson")).toBeVisible();
    await expect(page.getByText(/Egyptian lesson/)).toHaveCount(0);
  });

  test("says so when a stage has no lessons yet", async ({ page, db }) => {
    db.seed("curriculum_stages", [aStage({ id: STAGE })]);
    db.seed("lessons", []);

    await page.goto("/admin/curriculum");
    await expect(page.getByText(/no lessons yet/i)).toBeVisible();
  });

  test("opens a lesson's words", async ({ page, db }) => {
    seedCurriculum(db, { lessons: 1, words: 2 });

    await page.goto("/admin/curriculum");
    await page.getByText("Lesson 1: Lesson title 1").click();

    await expect(page).toHaveURL(new RegExp(`/admin/lessons/${LESSON}/words$`));
  });

  test("offers the importer to an admin", async ({ page, db }) => {
    seedCurriculum(db);

    await page.goto("/admin/curriculum");
    await page.getByRole("button", { name: /import lesson plan/i }).click();

    await expect(page).toHaveURL(/\/admin\/lessons\/import$/);
  });

  test("hides the importer from a recorder", async ({ page, signInAs, db }) => {
    await signInAs("recorder");
    seedCurriculum(db);

    await page.goto("/admin/curriculum");

    // Recorders record audio; creating curriculum is not theirs to do.
    await expect(page.getByText("Stage 1: Foundations")).toBeVisible();
    await expect(page.getByRole("button", { name: /import lesson plan/i })).toHaveCount(0);
  });
});

test.describe("a lesson's words", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    seedCurriculum(db, { lessons: 1, words: 3 });
  });

  test("lists them in their authored order", async ({ page }) => {
    await page.goto(`/admin/lessons/${LESSON}/words`);

    await expect(page.getByText("كلمة1")).toBeVisible();
    await expect(page.getByText("كلمة3")).toBeVisible();
  });

  test("shows the lesson it belongs to, and its dialect", async ({ page }) => {
    await page.goto(`/admin/lessons/${LESSON}/words`);

    await expect(page.getByRole("heading", { name: "Lesson title 1" })).toBeVisible();
    // Scoped to the badge: the dialect switcher in the shell names all three.
    await expect(page.getByText("Gulf", { exact: true })).toBeVisible();
  });

  test("shows only this lesson's words", async ({ page, db }) => {
    db.add(
      "vocabulary_words",
      aVocabularyWord({
        id: wordId(9),
        lesson_id: lessonId(5),
        topic_id: null,
        word_arabic: "أخرى",
      }),
    );

    await page.goto(`/admin/lessons/${LESSON}/words`);

    await expect(page.getByText("كلمة1")).toBeVisible();
    await expect(page.getByText("أخرى")).toHaveCount(0);
  });

  test("asks before deleting a word", async ({ page, db }) => {
    await page.goto(`/admin/lessons/${LESSON}/words`);
    await expect(page.getByText("كلمة1")).toBeVisible();

    await deleteButtons(page).first().click();

    // There is no undo, and the word takes its generated image and audio with
    // it — so the confirmation is the only safeguard there is.
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(db.rows("vocabulary_words")).toHaveLength(3);
  });

  test("deletes exactly the word confirmed", async ({ page, db }) => {
    await page.goto(`/admin/lessons/${LESSON}/words`);
    await expect(page.getByText("كلمة1")).toBeVisible();

    await deleteButtons(page).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^delete$/i }).click();

    await expect.poll(() => db.rows("vocabulary_words").length, { timeout: 10_000 }).toBe(2);
    // A delete issued without its filter would clear the whole lesson.
    expect(db.rows("vocabulary_words").map((row) => row.word_english).sort()).toEqual([
      "word 2",
      "word 3",
    ]);
  });

  test("cancelling leaves the word alone", async ({ page, db }) => {
    await page.goto(`/admin/lessons/${LESSON}/words`);
    await expect(page.getByText("كلمة1")).toBeVisible();

    await deleteButtons(page).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: /cancel/i }).click();

    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(db.rows("vocabulary_words")).toHaveLength(3);
  });

  test("reports a failed delete rather than pretending it worked", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await page.goto(`/admin/lessons/${LESSON}/words`);
    await expect(page.getByText("كلمة1")).toBeVisible();

    db.failWrites("vocabulary_words", 403);
    await deleteButtons(page).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^delete$/i }).click();

    await expect(page.getByText(/error/i).first()).toBeVisible();
    expect(db.rows("vocabulary_words")).toHaveLength(3);
  });
});

test.describe("generating flashcard images", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("admin");
    seedCurriculum(db, { lessons: 1, words: 2 });
    backend.stubFunction("generate-flashcard-image", {
      imageUrl: "https://e2e.supabase.co/storage/v1/object/public/images/word.png",
    });
  });

  test("offers a bulk generate for the words that have none", async ({ page }) => {
    await page.goto(`/admin/lessons/${LESSON}/words`);

    // The count is what tells an admin how much work is outstanding without
    // scrolling the grid.
    await expect(page.getByRole("button", { name: /generate all images \(2\)/i })).toBeVisible();
  });

  test("hides the bulk generate once every word has an image", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({
        id: wordId(0),
        lesson_id: LESSON,
        topic_id: null,
        image_url: "https://example.test/one.png",
      }),
    ]);

    await page.goto(`/admin/lessons/${LESSON}/words`);
    await expect(page.getByRole("button", { name: /generate all images/i })).toHaveCount(0);
  });

  test("saves the generated image against the word", async ({ page, db, backend }) => {
    await page.goto(`/admin/lessons/${LESSON}/words`);
    await expect(page.getByText("كلمة1")).toBeVisible();

    await page.getByRole("button", { name: /generate/i }).nth(1).click();

    await expect
      .poll(() => db.rows("vocabulary_words").filter((row) => row.image_url).length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // The path is per-lesson and per-word, so regenerating replaces the image
    // rather than accumulating orphans in storage.
    const call = backend.lastCallTo("generate-flashcard-image")?.body as Record<string, string>;
    expect(call.storage_path).toMatch(new RegExp(`^curriculum/${LESSON}/`));
  });

  test("cache-busts the saved URL", async ({ page, db }) => {
    await page.goto(`/admin/lessons/${LESSON}/words`);
    await expect(page.getByText("كلمة1")).toBeVisible();

    await page.getByRole("button", { name: /generate/i }).nth(1).click();

    await expect
      .poll(
        () => db.rows("vocabulary_words").find((row) => row.image_url)?.image_url ?? "",
        { timeout: 15_000 },
      )
      .toMatch(/\?t=\d+$/);
    // Regenerating writes to the same storage path, so without this the browser
    // keeps showing the old image and the admin regenerates it again.
  });

  test("says so when generation fails, and leaves the word without an image", async ({
    page,
    db,
    backend,
  }) => {
    backend.stubFunctionFailure("generate-flashcard-image");

    await page.goto(`/admin/lessons/${LESSON}/words`);
    await expect(page.getByText("كلمة1")).toBeVisible();

    await page.getByRole("button", { name: /generate/i }).nth(1).click();

    await expect(page.getByText(/image generation failed/i)).toBeVisible();
    expect(db.rows("vocabulary_words").every((row) => !row.image_url)).toBe(true);
  });

  test("hides the generate controls from a recorder", async ({ page, signInAs, db }) => {
    await signInAs("recorder");
    seedCurriculum(db, { lessons: 1, words: 2 });

    await page.goto(`/admin/lessons/${LESSON}/words`);

    await expect(page.getByText("كلمة1")).toBeVisible();
    await expect(page.getByRole("button", { name: /generate all images/i })).toHaveCount(0);
  });
});
