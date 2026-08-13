import { expect, test } from "./support/fixtures";
import {
  aConceptLink,
  aCurriculumConcept,
  aLesson,
  aStage,
  aVocabularyWord,
  conceptId,
  daysAgo,
  lessonId,
  many,
  stageId,
  wordId,
} from "../src/test/support/factories";

/**
 * `/admin/coverage` — what the curriculum already teaches.
 *
 * Two independent things share the page. The heatmap counts lessons and
 * vocabulary per stage × dialect and turns a thin cell into a drafting prompt;
 * the list below it is the concept ledger, filtered by dialect and kind and
 * searched client-side.
 *
 * Both read tables nothing else in the admin touches (`curriculum_concepts`,
 * `content_concept_links`), and both are cast through `as never` to get past
 * the generated types — so the column names have never been checked by
 * anything. That is what these tests are for.
 */

/** The heatmap cell for a stage row and a dialect column. */
const heatmapCell = (page: import("@playwright/test").Page, row: number, column: number) =>
  page.locator("tbody tr").nth(row).locator("td").nth(column + 1).locator("button");

test.describe("the concept ledger", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("curriculum_stages", []);
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);
  });

  test("says when nothing has been logged for the dialect", async ({ page, db }) => {
    db.seed("curriculum_concepts", []);
    await page.goto("/admin/coverage");

    await expect(page.getByRole("heading", { name: /curriculum coverage/i })).toBeVisible();
    await expect(page.getByText(/no concepts logged yet for Gulf/i)).toBeVisible();
    await expect(page.getByText("0 concepts")).toBeVisible();
  });

  test("shows a concept with its kind, level and Arabic", async ({ page, db }) => {
    db.seed("curriculum_concepts", [
      aCurriculumConcept({
        kind: "grammar",
        display_arabic: "الفعل الماضي",
        display_english: "past tense",
        cefr_level: "A2",
      }),
    ]);
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");

    await expect(page.getByText("الفعل الماضي")).toBeVisible();
    await expect(page.getByText("past tense")).toBeVisible();
    await expect(page.getByText("grammar")).toBeVisible();
    await expect(page.getByText("A2")).toBeVisible();
    await expect(page.getByText("1 concepts")).toBeVisible();
  });

  test("falls back to the key when there is no Arabic to show", async ({ page, db }) => {
    db.seed("curriculum_concepts", [
      aCurriculumConcept({ key: "greeting-formal", display_arabic: null }),
    ]);
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");

    await expect(page.getByText("greeting-formal")).toBeVisible();
  });

  test("shows an em dash for a concept with no level", async ({ page, db }) => {
    db.seed("curriculum_concepts", [aCurriculumConcept({ cefr_level: null })]);
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");

    await expect(page.getByText("—", { exact: true })).toBeVisible();
  });

  test("counts how often a concept has been used", async ({ page, db }) => {
    db.seed("curriculum_concepts", [aCurriculumConcept({ id: conceptId(0) })]);
    db.seed("content_concept_links", [
      aConceptLink({ id: "l-1", concept_id: conceptId(0), created_at: daysAgo(2) }),
      aConceptLink({ id: "l-2", concept_id: conceptId(0), role: "reinforce", created_at: daysAgo(1) }),
    ]);

    await page.goto("/admin/coverage");

    await expect(page.getByText(/Used 2×/)).toBeVisible();
  });

  test("reports a never-used concept as unused rather than omitting it", async ({ page, db }) => {
    db.seed("curriculum_concepts", [aCurriculumConcept({ id: conceptId(0) })]);
    db.seed("content_concept_links", [
      aConceptLink({ id: "l-1", concept_id: conceptId(1) }),
    ]);

    await page.goto("/admin/coverage");

    await expect(page.getByText(/Used 0×/)).toBeVisible();
  });

  test("only counts links belonging to the concept", async ({ page, db }) => {
    db.seed("curriculum_concepts", [
      aCurriculumConcept({ id: conceptId(0), display_arabic: "أول" }),
      aCurriculumConcept({ id: conceptId(1), key: "second", display_arabic: "ثاني" }),
    ]);
    db.seed("content_concept_links", [
      aConceptLink({ id: "l-1", concept_id: conceptId(0) }),
      aConceptLink({ id: "l-2", concept_id: conceptId(0) }),
      aConceptLink({ id: "l-3", concept_id: conceptId(1) }),
    ]);

    await page.goto("/admin/coverage");

    await expect(page.getByText(/Used 2×/)).toHaveCount(1);
    await expect(page.getByText(/Used 1×/)).toHaveCount(1);
  });

  test("shows the newest concept first", async ({ page, db }) => {
    db.seed(
      "curriculum_concepts",
      many(aCurriculumConcept, 3, (index) => ({
        id: conceptId(index),
        key: `concept-${index}`,
        display_arabic: null,
        first_introduced_at: daysAgo(index),
      })),
    );
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");

    const names = page.locator("div.font-medium.truncate");
    await expect(names).toHaveCount(3);
    await expect(names.first()).toHaveText("concept-0");
    await expect(names.last()).toHaveText("concept-2");
  });

  test("filters by dialect", async ({ page, db }) => {
    db.seed("curriculum_concepts", [
      aCurriculumConcept({ id: conceptId(0), display_arabic: "خليجي", dialect: "Gulf" }),
      aCurriculumConcept({
        id: conceptId(1),
        key: "cairo",
        display_arabic: "مصري",
        dialect: "Egyptian",
      }),
    ]);
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");
    await expect(page.getByText("خليجي")).toBeVisible();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Egyptian" }).click();

    await expect(page.getByText("مصري")).toBeVisible();
    await expect(page.getByText("خليجي")).toHaveCount(0);
    await expect(page.getByText(/no concepts logged yet for Egyptian/i)).toHaveCount(0);
  });

  test("filters by kind", async ({ page, db }) => {
    db.seed("curriculum_concepts", [
      aCurriculumConcept({ id: conceptId(0), display_arabic: "كلمة", kind: "vocab" }),
      aCurriculumConcept({ id: conceptId(1), key: "g", display_arabic: "قاعدة", kind: "grammar" }),
    ]);
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");
    await expect(page.getByText("2 concepts")).toBeVisible();

    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Grammar" }).click();

    await expect(page.getByText("قاعدة")).toBeVisible();
    await expect(page.getByText("كلمة")).toHaveCount(0);
  });

  test("searches the English gloss case-insensitively", async ({ page, db }) => {
    db.seed("curriculum_concepts", [
      aCurriculumConcept({ id: conceptId(0), display_arabic: null, key: "a", display_english: "Morning greeting" }),
      aCurriculumConcept({ id: conceptId(1), display_arabic: null, key: "b", display_english: "Farewell" }),
    ]);
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");
    await page.getByPlaceholder("Search…").fill("morning");

    await expect(page.getByText("Morning greeting")).toBeVisible();
    await expect(page.getByText("Farewell")).toHaveCount(0);
    await expect(page.getByText("1 concepts")).toBeVisible();
  });

  test("searches the key", async ({ page, db }) => {
    db.seed("curriculum_concepts", [
      aCurriculumConcept({ id: conceptId(0), display_arabic: null, key: "past-tense" }),
      aCurriculumConcept({ id: conceptId(1), display_arabic: null, key: "greeting" }),
    ]);
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");
    await page.getByPlaceholder("Search…").fill("tense");

    await expect(page.getByText("past-tense")).toBeVisible();
    await expect(page.getByText("greeting")).toHaveCount(0);
  });

  test("searches Arabic exactly as typed", async ({ page, db }) => {
    // The Arabic branch is the only one that does not lowercase, because there
    // is no case to fold — but it also does not normalise, so a search only
    // matches the same spelling that was stored.
    db.seed("curriculum_concepts", [
      aCurriculumConcept({ id: conceptId(0), key: "a", display_arabic: "صباح الخير" }),
      aCurriculumConcept({ id: conceptId(1), key: "b", display_arabic: "مساء الخير" }),
    ]);
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");
    await page.getByPlaceholder("Search…").fill("صباح");

    await expect(page.getByText("صباح الخير")).toBeVisible();
    await expect(page.getByText("مساء الخير")).toHaveCount(0);
  });

  test("a search matching nothing empties the list", async ({ page, db }) => {
    db.seed("curriculum_concepts", [aCurriculumConcept({ display_arabic: null, key: "greeting" })]);
    db.seed("content_concept_links", []);

    await page.goto("/admin/coverage");
    await page.getByPlaceholder("Search…").fill("nothing-like-this");

    await expect(page.getByText("0 concepts")).toBeVisible();
    // The empty card claims nothing is logged for the dialect, which is not
    // what happened — the filter is what emptied the list.
    await expect(page.getByText(/no concepts logged yet for Gulf/i)).toBeVisible();
  });
});

test.describe("the coverage heatmap", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("curriculum_concepts", []);
    db.seed("content_concept_links", []);
  });

  test("gives every stage a row and every dialect a column", async ({ page, db }) => {
    db.seed("curriculum_stages", [
      aStage({ id: stageId(0), name: "Foundations", stage_number: 1, cefr_level: "A1" }),
      aStage({ id: stageId(1), name: "Building", stage_number: 2, cefr_level: "A2" }),
    ]);
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);

    await page.goto("/admin/coverage");

    await expect(page.getByRole("heading", { name: /coverage heatmap/i })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(3);
    await expect(page.locator("thead th")).toHaveText([
      "Stage",
      "Gulf",
      "Egyptian",
      "Yemeni",
    ]);
    await expect(page.getByText("1. Foundations")).toBeVisible();
    await expect(page.getByText("2. Building")).toBeVisible();
  });

  test("counts words and lessons per stage and dialect", async ({ page, db }) => {
    db.seed("curriculum_stages", [aStage({ id: stageId(0), name: "Foundations" })]);
    db.seed("lessons", [
      aLesson({ id: lessonId(0), stage_id: stageId(0), dialect_module: "Gulf" }),
      aLesson({ id: lessonId(1), stage_id: stageId(0), dialect_module: "Gulf" }),
      aLesson({ id: lessonId(2), stage_id: stageId(0), dialect_module: "Egyptian" }),
    ]);
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), lesson_id: lessonId(0), dialect_module: "Gulf" }),
      aVocabularyWord({ id: wordId(1), lesson_id: lessonId(1), dialect_module: "Gulf" }),
      aVocabularyWord({ id: wordId(2), lesson_id: lessonId(2), dialect_module: "Egyptian" }),
    ]);

    await page.goto("/admin/coverage");

    await expect(heatmapCell(page, 0, 0)).toContainText("2");
    await expect(heatmapCell(page, 0, 0)).toContainText("2L");
    await expect(heatmapCell(page, 0, 1)).toContainText("1L");
    await expect(heatmapCell(page, 0, 2)).toContainText("0L");
  });

  test("does not count a word whose lesson sits in another stage", async ({ page, db }) => {
    db.seed("curriculum_stages", [
      aStage({ id: stageId(0), name: "Foundations", stage_number: 1 }),
      aStage({ id: stageId(1), name: "Building", stage_number: 2 }),
    ]);
    db.seed("lessons", [
      aLesson({ id: lessonId(0), stage_id: stageId(0), dialect_module: "Gulf" }),
      aLesson({ id: lessonId(1), stage_id: stageId(1), dialect_module: "Gulf" }),
    ]);
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), lesson_id: lessonId(1), dialect_module: "Gulf" }),
    ]);

    await page.goto("/admin/coverage");

    await expect(heatmapCell(page, 0, 0)).toContainText("0");
    await expect(heatmapCell(page, 1, 0)).toContainText("1");
  });

  test("ignores a word attached to no lesson at all", async ({ page, db }) => {
    db.seed("curriculum_stages", [aStage({ id: stageId(0) })]);
    db.seed("lessons", [aLesson({ id: lessonId(0), stage_id: stageId(0), dialect_module: "Gulf" })]);
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), lesson_id: null, dialect_module: "Gulf" }),
    ]);

    await page.goto("/admin/coverage");

    await expect(heatmapCell(page, 0, 0)).toContainText("0");
  });

  test("a thin cell drafts against that stage and dialect", async ({ page, db }) => {
    db.seed("curriculum_stages", [aStage({ id: stageId(0), name: "Foundations" })]);
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);

    await page.goto("/admin/coverage");
    await heatmapCell(page, 0, 1).click();

    await expect(page).toHaveURL(/\/admin\/curriculum-builder$/);
    // Clicking the Egyptian column switches the whole admin to Egyptian, which
    // is what the builder then drafts in.
    await expect(page.getByText(/Egyptian Arabic Module/)).toBeVisible();
  });

  test("labels each cell with what it counts", async ({ page, db }) => {
    db.seed("curriculum_stages", [aStage({ id: stageId(0) })]);
    db.seed("lessons", [aLesson({ id: lessonId(0), stage_id: stageId(0), dialect_module: "Gulf" })]);
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), lesson_id: lessonId(0), dialect_module: "Gulf" }),
    ]);

    await page.goto("/admin/coverage");

    await expect(heatmapCell(page, 0, 0)).toHaveAttribute(
      "title",
      "1 words · 1 lessons · click to draft",
    );
  });

  test("draws nothing when there are no stages", async ({ page, db }) => {
    db.seed("curriculum_stages", []);
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);

    await page.goto("/admin/coverage");

    await expect(page.getByRole("heading", { name: /coverage heatmap/i })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(0);
    // The legend still claims to explain a grid that is not there.
    await expect(page.getByText("Empty", { exact: true })).toBeVisible();
  });

  test("counts scenario and phrase concepts without ever showing them", async ({ page, db }) => {
    // Pinned, not fixed. `sentences` is computed per cell from the concept
    // ledger and then dropped — the cell renders words and lessons only, so
    // the whole third query exists to feed a number nobody sees.
    db.seed("curriculum_stages", [aStage({ id: stageId(0) })]);
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);
    db.seed("curriculum_concepts", [
      aCurriculumConcept({ id: conceptId(0), kind: "phrase", stage_id: stageId(0) }),
      aCurriculumConcept({ id: conceptId(1), key: "s", kind: "scenario", stage_id: stageId(0) }),
    ]);

    await page.goto("/admin/coverage");

    await expect(heatmapCell(page, 0, 0)).toHaveText(/^00L$/);
  });

  test("draws the grid anyway when the concept query fails", async ({ page, db }) => {
    // Pinned, not fixed. The lessons and vocabulary errors are rethrown, but
    // `conceptsRes.error` is never checked — a failed third query falls through
    // to `?? []`, so the heatmap renders as though every stage had no phrases.
    db.seed("curriculum_stages", [aStage({ id: stageId(0) })]);
    db.seed("lessons", [aLesson({ id: lessonId(0), stage_id: stageId(0), dialect_module: "Gulf" })]);
    db.seed("vocabulary_words", []);
    db.failAlways("curriculum_concepts", 500);

    await page.goto("/admin/coverage");

    await expect(heatmapCell(page, 0, 0)).toContainText("1L");
    await expect(page.getByText(/error|failed/i)).toHaveCount(0);
  });
});

test.describe("who can open it", () => {
  test.beforeEach(async ({ db }) => {
    db.seed("curriculum_stages", []);
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);
    db.seed("curriculum_concepts", []);
  });

  test("a recorder may read the coverage map", async ({ page, signInAs }) => {
    await signInAs("recorder");
    await page.goto("/admin/coverage");

    await expect(page.getByRole("heading", { name: /curriculum coverage/i })).toBeVisible();
  });

  test("a content reviewer is turned away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");
    await page.goto("/admin/coverage");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(/access denied/i)).toBeVisible();
  });

  test("a signed-in learner is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/admin/coverage");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
