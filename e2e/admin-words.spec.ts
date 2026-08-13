import { expect, test } from "./support/fixtures";
import { aTopic, aVocabularyWord, many, topicId, wordId } from "../src/test/support/factories";

/**
 * The legacy vocabulary editor: `/admin/topics/:id/words` and the two forms
 * behind it.
 *
 * `admin-crud.spec.ts` proves the word list renders the right words. This is
 * everything an admin or a recorder actually does there — the single-word form
 * with its AI image step, and the bulk importer's three entry modes.
 *
 * The bulk importer is the interesting half: three parsers (paste, CSV, audio
 * filename matching) that exist nowhere else in the app and have never had a
 * line of coverage.
 */

const TOPIC = topicId(0);

test.describe("the word list", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("topics", [aTopic({ id: TOPIC, name: "Colours", icon: "🎨" })]);
  });

  test("offers bulk import and single entry", async ({ page, db }) => {
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${TOPIC}/words`);

    await page.getByRole("button", { name: /bulk import/i }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words/bulk$`));

    await page.goBack();
    await page.getByRole("button", { name: /add word/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words/new$`));
  });

  test("opens a word for editing", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), topic_id: TOPIC, word_english: "red" }),
    ]);
    await page.goto(`/admin/topics/${TOPIC}/words`);

    await page.getByRole("button", { name: /^edit$/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words/${wordId(0)}/edit$`));
  });

  test("asks before deleting a word", async ({ page, db }) => {
    db.seed("vocabulary_words", [aVocabularyWord({ id: wordId(0), topic_id: TOPIC })]);
    await page.goto(`/admin/topics/${TOPIC}/words`);

    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByRole("heading", { name: /delete word/i })).toBeVisible();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    expect(db.writesTo("vocabulary_words")).toHaveLength(0);
  });

  test("deletes once confirmed", async ({ page, db }) => {
    db.seed("vocabulary_words", [aVocabularyWord({ id: wordId(0), topic_id: TOPIC })]);
    await page.goto(`/admin/topics/${TOPIC}/words`);

    await page.locator("button:has(svg.lucide-trash2)").click();
    await page.getByRole("button", { name: /^delete$/i }).click();

    await expect(page.getByText(/word deleted successfully/i)).toBeVisible();
    expect(db.rows("vocabulary_words")).toHaveLength(0);
  });

  test("cancelling keeps the word", async ({ page, db }) => {
    db.seed("vocabulary_words", [aVocabularyWord({ id: wordId(0), topic_id: TOPIC })]);
    await page.goto(`/admin/topics/${TOPIC}/words`);

    await page.locator("button:has(svg.lucide-trash2)").click();
    await page.getByRole("button", { name: /cancel/i }).click();

    expect(db.rows("vocabulary_words")).toHaveLength(1);
  });

  test("reports a rejected delete", async ({ page, db }) => {
    db.seed("vocabulary_words", [aVocabularyWord({ id: wordId(0), topic_id: TOPIC })]);
    await page.goto(`/admin/topics/${TOPIC}/words`);

    db.failWrites("vocabulary_words", 403);
    await page.locator("button:has(svg.lucide-trash2)").click();
    await page.getByRole("button", { name: /^delete$/i }).click();

    await expect(page.getByText(/error deleting word/i)).toBeVisible();
    expect(db.rows("vocabulary_words")).toHaveLength(1);
  });

  test("says so rather than failing silently when a word has no audio", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), topic_id: TOPIC, audio_url: null }),
    ]);
    await page.goto(`/admin/topics/${TOPIC}/words`);

    await page.locator("button:has(svg.lucide-volume2)").click();

    await expect(page.getByText("No audio", { exact: true })).toBeVisible();
    await expect(page.getByText(/has no audio file yet/i)).toBeVisible();
  });

  test("a recorder may edit but not delete", async ({ page, signInAs, db }) => {
    await signInAs("recorder");
    db.seed("vocabulary_words", [aVocabularyWord({ id: wordId(0), topic_id: TOPIC })]);
    await page.goto(`/admin/topics/${TOPIC}/words`);

    await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
    await expect(page.locator("button:has(svg.lucide-trash2)")).toHaveCount(0);
  });

  test("says so when the topic does not exist", async ({ page, db }) => {
    db.seed("topics", []);
    db.seed("vocabulary_words", []);

    await page.goto(`/admin/topics/${TOPIC}/words`);

    await expect(page.getByText(/topic not found/i)).toBeVisible();
  });
});

test.describe("the single-word form", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("topics", [aTopic({ id: TOPIC, name: "Colours", icon: "🎨" })]);
  });

  test("creates a word with the values entered", async ({ page, db }) => {
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByLabel("Arabic Word").fill("أحمر");
    await page.getByLabel("English Word").fill("red");
    await page.getByRole("button", { name: /create word/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words$`));
    expect(db.lastWriteTo("vocabulary_words")?.payload[0]).toMatchObject({
      topic_id: TOPIC,
      word_arabic: "أحمر",
      word_english: "red",
      display_order: 0,
    });
  });

  test("puts a new word after the last one", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), topic_id: TOPIC, display_order: 4 }),
    ]);
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByLabel("Arabic Word").fill("أزرق");
    await page.getByLabel("English Word").fill("blue");
    await page.getByRole("button", { name: /create word/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words$`));
    expect(db.lastWriteTo("vocabulary_words")?.payload[0]).toMatchObject({ display_order: 5 });
  });

  test("will not submit without both halves", async ({ page, db }) => {
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByLabel("Arabic Word").fill("أحمر");
    await page.getByRole("button", { name: /create word/i }).click();

    // Both inputs are `required`, so the browser stops the submit before the
    // app's own check ever runs.
    expect(db.writesTo("vocabulary_words")).toHaveLength(0);
    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words/new$`));
  });

  test("prefills when editing and patches rather than inserting", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({
        id: wordId(0),
        topic_id: TOPIC,
        word_arabic: "أحمر",
        word_english: "red",
      }),
    ]);
    await page.goto(`/admin/topics/${TOPIC}/words/${wordId(0)}/edit`);

    await expect(page.getByLabel("Arabic Word")).toHaveValue("أحمر");
    await expect(page.getByLabel("English Word")).toHaveValue("red");

    await page.getByLabel("English Word").fill("crimson");
    await page.getByRole("button", { name: /update word/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words$`));
    const write = db.lastWriteTo("vocabulary_words");
    expect(write?.method).toBe("PATCH");
    expect(write?.payload[0]).toMatchObject({ word_english: "crimson" });
  });

  test("cancelling writes nothing", async ({ page, db }) => {
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByLabel("Arabic Word").fill("أحمر");
    await page.getByRole("button", { name: /^cancel$/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words$`));
    expect(db.writesTo("vocabulary_words")).toHaveLength(0);
  });

  test("reports a rejected save and stays on the form", async ({ page, db }) => {
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByLabel("Arabic Word").fill("أحمر");
    await page.getByLabel("English Word").fill("red");
    db.failWrites("vocabulary_words", 403);
    await page.getByRole("button", { name: /create word/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words/new$`));
    await expect(page.getByLabel("English Word")).toHaveValue("red");
  });

  test("needs the English word before it will ask the AI for a picture", async ({
    page,
    db,
    backend,
  }) => {
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByRole("button", { name: /ai generate image/i }).click();

    await expect(page.getByText(/enter english word first/i)).toBeVisible();
    expect(backend.callsTo("generate-flashcard-image")).toHaveLength(0);
  });

  test("reuses an existing picture for the same English word", async ({
    page,
    db,
    backend,
    allowExternalHosts,
  }) => {
    // The chosen image is rendered in an <img>, and every foreign host is
    // blocked at request level; declaring it keeps the leak check honest.
    allowExternalHosts(["cdn.test"]);
    // The lookup is `ilike`, so an existing "Red" answers for "red" — which is
    // the point: the same noun should not be redrawn per topic.
    db.seed("vocabulary_words", [
      aVocabularyWord({
        id: wordId(0),
        word_english: "Red",
        image_url: "https://cdn.test/red.png",
      }),
    ]);
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByLabel("English Word").fill("red");
    await page.getByRole("button", { name: /ai generate image/i }).click();

    await expect(page.getByText(/reused existing image/i)).toBeVisible();
    expect(backend.callsTo("generate-flashcard-image")).toHaveLength(0);
  });

  test("generates one when nothing matches", async ({
    page,
    db,
    backend,
    allowExternalHosts,
  }) => {
    allowExternalHosts(["cdn.test"]);
    db.seed("vocabulary_words", []);
    backend.stubFunction("generate-flashcard-image", { imageUrl: "https://cdn.test/new.png" });
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByLabel("Arabic Word").fill("أحمر");
    await page.getByLabel("English Word").fill("red");
    await page.getByRole("button", { name: /ai generate image/i }).click();

    await expect(page.getByText(/image generated/i)).toBeVisible();
    expect(backend.lastCallTo("generate-flashcard-image")?.body).toMatchObject({
      word_english: "red",
      word_arabic: "أحمر",
    });
  });

  test("passes custom instructions and skips the reuse lookup", async ({
    page,
    db,
    backend,
    allowExternalHosts,
  }) => {
    allowExternalHosts(["cdn.test"]);
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), word_english: "red", image_url: "https://cdn.test/red.png" }),
    ]);
    backend.stubFunction("generate-flashcard-image", { imageUrl: "https://cdn.test/new.png" });
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByLabel("English Word").fill("red");
    await page.getByPlaceholder(/custom instructions/i).fill("a red apple on a wooden table");
    await page.getByRole("button", { name: /ai generate image/i }).click();

    await expect(page.getByText(/image generated/i)).toBeVisible();
    expect(backend.lastCallTo("generate-flashcard-image")?.body).toMatchObject({
      custom_instructions: "a red apple on a wooden table",
    });
  });

  test("offers to regenerate once a picture is attached", async ({
    page,
    db,
    backend,
    allowExternalHosts,
  }) => {
    allowExternalHosts(["cdn.test"]);
    db.seed("vocabulary_words", [
      aVocabularyWord({
        id: wordId(0),
        topic_id: TOPIC,
        word_english: "red",
        image_url: "https://cdn.test/red.png",
      }),
    ]);
    backend.stubFunction("generate-flashcard-image", { imageUrl: "https://cdn.test/new.png" });
    await page.goto(`/admin/topics/${TOPIC}/words/${wordId(0)}/edit`);

    await expect(page.getByRole("button", { name: /regenerate image/i })).toBeVisible();
    await page.getByRole("button", { name: /regenerate image/i }).click();

    await expect(page.getByText(/image generated/i)).toBeVisible();
    expect(backend.callsTo("generate-flashcard-image")).toHaveLength(1);
  });

  test("reports a failed generation", async ({ page, db, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    db.seed("vocabulary_words", []);
    backend.stubFunctionFailure("generate-flashcard-image", 500);
    await page.goto(`/admin/topics/${TOPIC}/words/new`);

    await page.getByLabel("English Word").fill("red");
    await page.getByRole("button", { name: /ai generate image/i }).click();

    await expect(page.getByText(/generation failed/i)).toBeVisible();
  });
});

test.describe("the bulk importer", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("topics", [aTopic({ id: TOPIC, name: "Colours", icon: "🎨" })]);
    db.seed("vocabulary_words", []);
  });

  test("opens with three empty rows and nothing to save", async ({ page }) => {
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);

    await expect(page.getByPlaceholder("Arabic word")).toHaveCount(3);
    await expect(page.getByText("0 valid words")).toBeVisible();
    await expect(page.getByRole("button", { name: /save all/i })).toBeDisabled();
  });

  test("counts a row as valid only once both halves are filled", async ({ page }) => {
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);

    await page.getByPlaceholder("Arabic word").first().fill("أحمر");
    await expect(page.getByText("0 valid words")).toBeVisible();

    await page.getByPlaceholder("English translation").first().fill("red");
    await expect(page.getByText("1 valid word")).toBeVisible();
    await expect(page.getByRole("button", { name: /save all \(1\)/i })).toBeEnabled();
  });

  test("adds rows one, five and ten at a time", async ({ page }) => {
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);

    await page.getByRole("button", { name: /add 1 row/i }).click();
    await expect(page.getByPlaceholder("Arabic word")).toHaveCount(4);

    await page.getByRole("button", { name: /add 5 rows/i }).click();
    await expect(page.getByPlaceholder("Arabic word")).toHaveCount(9);

    await page.getByRole("button", { name: /add 10 rows/i }).click();
    await expect(page.getByPlaceholder("Arabic word")).toHaveCount(19);
  });

  test("removes a row", async ({ page }) => {
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);

    await page.locator("button:has(svg.lucide-trash2)").first().click();

    await expect(page.getByPlaceholder("Arabic word")).toHaveCount(2);
  });

  test("saves every valid row and ignores the blanks", async ({ page, db }) => {
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);

    await page.getByPlaceholder("Arabic word").nth(0).fill("أحمر");
    await page.getByPlaceholder("English translation").nth(0).fill("red");
    await page.getByPlaceholder("Arabic word").nth(1).fill("أزرق");
    await page.getByPlaceholder("English translation").nth(1).fill("blue");

    await page.getByRole("button", { name: /save all \(2\)/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words$`));
    const payload = db.lastWriteTo("vocabulary_words")?.payload ?? [];
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({
      topic_id: TOPIC,
      word_arabic: "أحمر",
      word_english: "red",
      display_order: 0,
    });
    expect(payload[1]).toMatchObject({ word_english: "blue", display_order: 1 });
  });

  test("continues the running order from the words already there", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), topic_id: TOPIC, display_order: 7 }),
    ]);
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);

    await page.getByPlaceholder("Arabic word").nth(0).fill("أحمر");
    await page.getByPlaceholder("English translation").nth(0).fill("red");
    await page.getByRole("button", { name: /save all/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words$`));
    expect(db.lastWriteTo("vocabulary_words")?.payload[0]).toMatchObject({ display_order: 8 });
  });

  test("reports a rejected save without leaving the page", async ({ page, db }) => {
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);

    await page.getByPlaceholder("Arabic word").nth(0).fill("أحمر");
    await page.getByPlaceholder("English translation").nth(0).fill("red");
    db.failWrites("vocabulary_words", 403);
    await page.getByRole("button", { name: /save all/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words/bulk$`));
    await expect(page.getByPlaceholder("Arabic word").nth(0)).toHaveValue("أحمر");
  });
});

test.describe("pasting a word list", () => {
  test.beforeEach(async ({ signInAs, db, page }) => {
    await signInAs("admin");
    db.seed("topics", [aTopic({ id: TOPIC })]);
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);
    await page.getByRole("tab", { name: /paste data/i }).click();
  });

  test("splits tab-separated rows", async ({ page }) => {
    await page.getByPlaceholder(/أحمر/).fill("أحمر\tRed\nأزرق\tBlue");
    await page.getByRole("button", { name: /import pasted data/i }).click();

    await expect(page.getByText("2 words imported from paste")).toBeVisible();
    await expect(page.getByText("2 valid words")).toBeVisible();
    await expect(page.getByPlaceholder("Arabic word").first()).toHaveValue("أحمر");
  });

  test("falls back to commas", async ({ page }) => {
    await page.getByPlaceholder(/أحمر/).fill("أحمر,Red\nأزرق,Blue");
    await page.getByRole("button", { name: /import pasted data/i }).click();

    await expect(page.getByText("2 words imported from paste")).toBeVisible();
  });

  test("drops the empty rows that were there before", async ({ page }) => {
    await page.getByPlaceholder(/أحمر/).fill("أحمر\tRed");
    await page.getByRole("button", { name: /import pasted data/i }).click();

    await expect(page.getByPlaceholder("Arabic word")).toHaveCount(1);
  });

  test("keeps a row already being typed", async ({ page }) => {
    await page.getByRole("tab", { name: /manual entry/i }).click();
    await page.getByPlaceholder("Arabic word").first().fill("أخضر");

    await page.getByRole("tab", { name: /paste data/i }).click();
    await page.getByPlaceholder(/أحمر/).fill("أحمر\tRed");
    await page.getByRole("button", { name: /import pasted data/i }).click();

    await expect(page.getByPlaceholder("Arabic word")).toHaveCount(2);
    await expect(page.getByPlaceholder("Arabic word").first()).toHaveValue("أخضر");
  });

  test("says so when no line has two halves", async ({ page }) => {
    await page.getByPlaceholder(/أحمر/).fill("just one column\nand another");
    await page.getByRole("button", { name: /import pasted data/i }).click();

    await expect(page.getByText(/no valid data found/i)).toBeVisible();
    await expect(page.getByText(/Make sure each line has/i)).toBeVisible();
  });

  test("skips a line missing one half but keeps the rest", async ({ page }) => {
    await page.getByPlaceholder(/أحمر/).fill("أحمر\tRed\nأزرق\t\nأخضر\tGreen");
    await page.getByRole("button", { name: /import pasted data/i }).click();

    await expect(page.getByText("2 words imported from paste")).toBeVisible();
  });

  test("clears the box once imported", async ({ page }) => {
    await page.getByPlaceholder(/أحمر/).fill("أحمر\tRed");
    await page.getByRole("button", { name: /import pasted data/i }).click();

    await expect(page.getByPlaceholder(/أحمر/)).toHaveValue("");
    await expect(page.getByRole("button", { name: /import pasted data/i })).toBeDisabled();
  });
});

test.describe("uploading a word list", () => {
  test.beforeEach(async ({ signInAs, db, page }) => {
    await signInAs("admin");
    db.seed("topics", [aTopic({ id: TOPIC })]);
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);
    await page.getByRole("tab", { name: /upload file/i }).click();
  });

  const upload = async (page: import("@playwright/test").Page, name: string, body: string) => {
    await page.locator('input[accept=".csv,.txt,.tsv"]').setInputFiles({
      name,
      mimeType: "text/csv",
      buffer: Buffer.from(body, "utf8"),
    });
  };

  test("reads a two-column CSV", async ({ page }) => {
    await upload(page, "words.csv", "أحمر,Red\nأزرق,Blue\n");

    await expect(page.getByText("2 words imported from file")).toBeVisible();
    await expect(page.getByText("2 valid words")).toBeVisible();
  });

  test("skips a header row that names its columns", async ({ page }) => {
    await upload(page, "words.csv", "Arabic,English\nأحمر,Red\n");

    await expect(page.getByText("1 words imported from file")).toBeVisible();
  });

  test("keeps a first row that is data, not a header", async ({ page }) => {
    await upload(page, "words.csv", "أحمر,Red\nأزرق,Blue\n");

    await expect(page.getByText("2 words imported from file")).toBeVisible();
  });

  test("reads tab-separated files too", async ({ page }) => {
    await upload(page, "words.tsv", "أحمر\tRed\nأزرق\tBlue\n");

    await expect(page.getByText("2 words imported from file")).toBeVisible();
  });

  test("respects quoted fields containing commas", async ({ page }) => {
    await upload(page, "words.csv", '"أحمر, قاني","Red, deep"\n');

    await expect(page.getByText("1 words imported from file")).toBeVisible();
    await expect(page.getByPlaceholder("English translation").first()).toHaveValue("Red, deep");
  });

  test("says so when the file has nothing usable", async ({ page }) => {
    await upload(page, "words.csv", "one-column\nanother\n");

    await expect(page.getByText(/no valid data found/i)).toBeVisible();
    await expect(page.getByText(/Arabic in column 1/i).last()).toBeVisible();
  });

  test("treats a header-only file as empty", async ({ page }) => {
    // Pinned, not fixed. A file whose only row is "Arabic,English" is skipped
    // as a header and then reported as having no valid data — the same message
    // a genuinely malformed file gets, so the admin cannot tell which happened.
    await upload(page, "words.csv", "Arabic,English\n");

    await expect(page.getByText(/no valid data found/i)).toBeVisible();
  });

  test("accepts a second file after the first", async ({ page }) => {
    // The input's value is cleared after each read, which is what makes
    // re-uploading the same file work at all.
    await upload(page, "words.csv", "أحمر,Red\n");
    await expect(page.getByText("1 words imported from file")).toBeVisible();

    await upload(page, "words.csv", "أزرق,Blue\n");

    await expect(page.getByText("2 valid words")).toBeVisible();
  });
});

test.describe("matching audio files to words", () => {
  test.beforeEach(async ({ signInAs, db, page }) => {
    await signInAs("admin");
    db.seed("topics", [aTopic({ id: TOPIC })]);
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${TOPIC}/words/bulk`);
    await page.getByRole("tab", { name: /paste data/i }).click();
    await page.getByPlaceholder(/أحمر/).fill("أحمر\tRed\nأزرق\tBlue");
    await page.getByRole("button", { name: /import pasted data/i }).click();
    await page.getByRole("tab", { name: /upload file/i }).click();
  });

  const uploadAudio = async (page: import("@playwright/test").Page, names: string[]) =>
    page.locator('input[accept="audio/*"]').setInputFiles(
      names.map((name) => ({
        name,
        mimeType: "audio/mpeg",
        buffer: Buffer.from("fixture-audio"),
      })),
    );

  test("matches on the English word", async ({ page }) => {
    await uploadAudio(page, ["red.mp3"]);

    await expect(page.getByText("1 audio files matched to words")).toBeVisible();
  });

  test("matches on the Arabic word", async ({ page }) => {
    await uploadAudio(page, ["أحمر.mp3"]);

    await expect(page.getByText("1 audio files matched to words")).toBeVisible();
  });

  test("matches case-insensitively", async ({ page }) => {
    await uploadAudio(page, ["RED.MP3"]);

    await expect(page.getByText("1 audio files matched to words")).toBeVisible();
  });

  test("says so when nothing matches, and explains the naming", async ({ page }) => {
    await uploadAudio(page, ["something-else.mp3"]);

    await expect(page.getByText("No matches found")).toBeVisible();
    await expect(page.getByText(/Name audio files with the Arabic or English word/)).toBeVisible();
  });

  test("uploads a matched clip to storage on save", async ({ page, backend, db }) => {
    await uploadAudio(page, ["red.mp3"]);
    await expect(page.getByText("1 audio files matched to words")).toBeVisible();

    await page.getByRole("button", { name: /save all/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/topics/${TOPIC}/words$`));
    expect(backend.uploads().some((key) => key.includes("flashcard-audio"))).toBe(true);
    const payload = db.lastWriteTo("vocabulary_words")?.payload ?? [];
    expect(payload[0].audio_url).toContain("flashcard-audio");
    expect(payload[1].audio_url).toBeNull();
  });
});
