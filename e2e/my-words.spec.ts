import { expect, test } from "./support/fixtures";
import { aUserVocabulary, many, vocabId, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * My Words — the learner's own saved vocabulary.
 *
 * This is the only data in the app the learner created themselves, so a bug
 * that deletes the wrong card destroys work nothing can restore. The bulk
 * delete is the sharp edge: it chunks ids into batches of 200 and, before the
 * backend honoured filters, no test could tell whether it deleted the selection
 * or the whole deck.
 */

const OTHER_USER = "00000000-0000-4000-8000-000000000009";

function seedWords(db: MemoryDb, count: number, over: (index: number) => Record<string, unknown> = () => ({})) {
  db.seed(
    "user_vocabulary",
    many(aUserVocabulary, count, (index) => ({
      id: vocabId(index),
      user_id: TEST_USER_ID,
      word_arabic: `كلمة${index + 1}`,
      word_english: `word ${index + 1}`,
      ...over(index),
    })),
  );
}

test.describe("the list", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows the learner's saved words", async ({ page, db }) => {
    seedWords(db, 3);
    await page.goto("/my-words");

    await expect(page.getByText("كلمة1")).toBeVisible();
    await expect(page.getByText("كلمة3")).toBeVisible();
  });

  test("shows nothing belonging to another learner", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_arabic: "مِلكي" }),
      aUserVocabulary({ id: vocabId(1), user_id: OTHER_USER, word_arabic: "لغيري" }),
    ]);

    await page.goto("/my-words");

    await expect(page.getByText("مِلكي")).toBeVisible();
    await expect(page.getByText("لغيري")).toHaveCount(0);
  });

  test("says so when nothing has been saved yet", async ({ page, db }) => {
    db.seed("user_vocabulary", []);
    await page.goto("/my-words");

    await expect(page.getByText(/لا كلمات محفوظة|أضف من نص/).first()).toBeVisible();
  });

  test("does not claim an empty deck when the query failed", async ({ page, db }) => {
    // "You haven't saved any words" after a failed request tells the learner
    // their vocabulary is gone.
    db.failAlways("user_vocabulary", 500);
    await page.goto("/my-words");

    await expect(page.getByText(/haven't saved|no words yet/i)).toHaveCount(0);
  });

  test("scopes the list to the active dialect", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), dialect: "Gulf", word_arabic: "خليجي" }),
      aUserVocabulary({ id: vocabId(1), dialect: "Egyptian", word_arabic: "مصري" }),
    ]);

    await page.goto("/my-words");

    await expect(page.getByText("خليجي")).toBeVisible();
    await expect(page.getByText("مصري")).toHaveCount(0);
  });
});

test.describe("filters", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("narrows to a deck", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), deck_name: "Anki import", word_arabic: "منكي" }),
      aUserVocabulary({ id: vocabId(1), deck_name: null, word_arabic: "بدون" }),
    ]);

    await page.goto("/my-words");
    await expect(page.getByText("منكي")).toBeVisible();

    await page.getByRole("button", { name: /anki import/i }).first().click();

    await expect(page.getByText("منكي")).toBeVisible();
    await expect(page.getByText("بدون")).toHaveCount(0);
  });

  test("narrows to a tag", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), tags: ["food"], word_arabic: "طعام" }),
      aUserVocabulary({ id: vocabId(1), tags: ["travel"], word_arabic: "سفر" }),
    ]);

    await page.goto("/my-words");
    await page.getByRole("button", { name: /^#food/i }).first().click();

    await expect(page.getByText("طعام")).toBeVisible();
    await expect(page.getByText("سفر")).toHaveCount(0);
  });

  test("filtering never touches the server, so nothing can be lost by it", async ({ page, db }) => {
    // The filters are client-side over an already-loaded list. A filter that
    // issued a delete would be catastrophic, so this pins that it does not.
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), tags: ["food"], word_arabic: "طعام" }),
      aUserVocabulary({ id: vocabId(1), tags: ["travel"], word_arabic: "سفر" }),
    ]);

    await page.goto("/my-words");
    await page.getByRole("button", { name: /^#food/i }).first().click();

    expect(db.writesTo("user_vocabulary")).toHaveLength(0);
    expect(db.rows("user_vocabulary")).toHaveLength(2);
  });
});

test.describe("deleting", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("removes exactly the card asked for", async ({ page, db }) => {
    seedWords(db, 3);
    await page.goto("/my-words");
    await expect(page.getByText("كلمة1")).toBeVisible();

    // Each card carries its own delete control.
    await page.getByRole("button", { name: "احذف word 1" }).click();

    await expect
      .poll(() => db.rows("user_vocabulary").length, { timeout: 10_000 })
      .toBe(2);

    // Exactly that one — a delete issued without its filter would clear the
    // whole deck, and the count alone would not distinguish the two.
    expect(db.rows("user_vocabulary").map((row) => row.word_english).sort()).toEqual([
      "word 2",
      "word 3",
    ]);
  });

  test("a failed delete leaves the card in place", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);

    seedWords(db, 2);
    await page.goto("/my-words");
    await expect(page.getByText("كلمة1")).toBeVisible();

    db.failWrites("user_vocabulary", 403);
    await page.getByRole("button", { name: "احذف word 1" }).click();

    await page.waitForTimeout(500);
    expect(db.rows("user_vocabulary")).toHaveLength(2);
  });
});

test.describe("the free-tier vocabulary cap", () => {
  test("a free learner is not stopped from saving beyond ten words", async ({ page, signInAs, db }) => {
    // Recording current behaviour. src/lib/featureAccess.ts declares
    // FREE_TIER_LIMITS.vocabularyWords = 10 and STANDARD_TIER_LIMITS = 100, but
    // nothing imports either constant — the caps are declared and never
    // enforced. This will fail if they are ever wired up, which is the point.
    await signInAs("free");
    seedWords(db, 25);

    await page.goto("/my-words");

    await expect(page.getByText("كلمة25")).toBeVisible();
    await expect(page.getByText(/upgrade|limit reached|free plan/i)).toHaveCount(0);
  });
});

test.describe("word families", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("groups the deck by family, whatever spelling each card was saved with", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      // Three spellings of one family. Before they were canonicalised these
      // were three strangers, and the grouping this test asserts was impossible.
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_english: "act", word_family: "Act" }),
      aUserVocabulary({ id: vocabId(1), user_id: TEST_USER_ID, word_english: "action", word_family: "act" }),
      aUserVocabulary({ id: vocabId(2), user_id: TEST_USER_ID, word_english: "actor", word_family: " ACT " }),
      aUserVocabulary({ id: vocabId(3), user_id: TEST_USER_ID, word_english: "form", word_family: "form" }),
      aUserVocabulary({ id: vocabId(4), user_id: TEST_USER_ID, word_english: "formal", word_family: "form" }),
    ]);

    await page.goto("/my-words");

    await expect(page.getByText("عائلات الكلمات", { exact: true })).toBeVisible();
    // Biggest family first.
    await expect(page.getByRole("button", { name: /act · 3/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /form · 2/ })).toBeVisible();
  });

  test("filtering by a family narrows the list to it", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_english: "action", word_family: "act" }),
      aUserVocabulary({ id: vocabId(1), user_id: TEST_USER_ID, word_english: "actor", word_family: "Act" }),
      aUserVocabulary({ id: vocabId(2), user_id: TEST_USER_ID, word_english: "formal", word_family: "form" }),
      aUserVocabulary({ id: vocabId(3), user_id: TEST_USER_ID, word_english: "form", word_family: "form" }),
    ]);

    await page.goto("/my-words");
    await page.getByRole("button", { name: /act · 2/ }).click();

    await expect(page.getByText("actor")).toBeVisible();
    await expect(page.getByText("formal")).toHaveCount(0);
  });

  test("keeps quiet when no two words share a family", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_english: "action", word_family: "act" }),
      aUserVocabulary({ id: vocabId(1), user_id: TEST_USER_ID, word_english: "formal", word_family: "form" }),
    ]);

    await page.goto("/my-words");

    await expect(page.getByText("action")).toBeVisible();
    // Two families of one is not a shelf worth showing. The backfill prompt is
    // also absent, because every word here already has a family.
    await expect(page.getByText("عائلات الكلمات", { exact: true })).toHaveCount(0);
  });

  test("offers to look up the families that are missing, and never does it unasked", async ({ page, db, backend }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_english: "action", word_family: null }),
      aUserVocabulary({ id: vocabId(1), user_id: TEST_USER_ID, word_english: "actor", word_family: null }),
    ]);
    backend.stubFunction("enrich-word-roots", { ok: true, examined: 2, resolved: 2, skippedFree: 0 });

    await page.goto("/my-words");
    await expect(page.getByRole("button", { name: /دوّر عائلات لـ2/ })).toBeVisible();

    // Nothing has been spent just by opening the page: this is the only part of
    // the feature that costs credits, and it waits to be asked twice.
    expect(backend.functionCalls.filter((c) => c.name === "enrich-word-roots")).toHaveLength(0);

    await page.getByRole("button", { name: /دوّر عائلات لـ2/ }).click();
    await page.getByRole("button", { name: "دوّر العائلات" }).click();

    await expect
      .poll(() => backend.functionCalls.filter((c) => c.name === "enrich-word-roots").length)
      .toBe(1);
  });
});
