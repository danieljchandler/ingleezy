import { expect, test, type Page } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * Translate & Save, flipped: paste the English you met in the wild — a
 * message, an email — and read it back sentence-by-sentence in your own
 * dialect, with a word-order gloss and a note when an idiom would mislead.
 *
 * The tap-to-save path underneath is TappableEnglishText: every word of the
 * English is a lookup target glossed through translate-phrase, and the only
 * route by which a word gets into My Words from free text on this page.
 *
 * `translate-text` is an AI call, so the specs also pin what happens when it
 * fails: a page that renders an empty result on a failed translation looks
 * like the text had nothing in it.
 */

const ENGLISH_TEXT = "How are you today? Come have coffee with us.";

/** The two-sentence response the translate function returns. */
const TRANSLATION = {
  detected_dialect: "Gulf",
  used_dialect: "Gulf",
  sentences: [
    {
      english: "How are you today?",
      arabic: "شخبارك اليوم؟",
      literal: "كيف انت اليوم؟",
      note: "تحية يومية بين الأصحاب.",
    },
    {
      english: "Come have coffee with us.",
      arabic: "تعال نشرب قهوة معنا.",
      literal: "تعال خذ قهوة معنا.",
    },
  ],
};

function stubTranslate(backend: SupabaseBackend, response: unknown = TRANSLATION) {
  backend.stubFunction("translate-text", response);
}

/** Paste text and run the translation. */
async function translate(page: Page, text = ENGLISH_TEXT) {
  await page.getByRole("textbox").fill(text);
  await page.getByRole("button", { name: /^translate$/i }).click();
}

test.describe("translating a passage", () => {
  test.beforeEach(async ({ signInAs, backend }) => {
    await signInAs("free");
    stubTranslate(backend);
  });

  test("sends the text and the learner's dialect for the glosses", async ({ page, backend }) => {
    await page.goto("/translate");
    await translate(page);

    // Assert on a line that only exists in the stubbed response, not on the
    // passage text: ENGLISH_TEXT contains "How are you today?", so matching
    // that would pass off the textarea before any request went out.
    await expect(page.getByText("تعال نشرب قهوة معنا.")).toBeVisible();
    // "My dialect" resolves to the active dialect before the call — there is
    // nothing to auto-detect about pasted English.
    expect(backend.lastCallTo("translate-text")?.body).toMatchObject({
      text: ENGLISH_TEXT,
      dialect: "Gulf",
    });
  });

  test("passes an explicit dialect when one is picked", async ({ page, backend }) => {
    await page.goto("/translate");
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Egyptian" }).click();
    // Wait for the pick to land before translating. The select closes with an
    // animation that briefly keeps an overlay over the page, and a Translate
    // click inside that window is swallowed — the request never goes out.
    await expect(page.getByRole("combobox")).toContainText("Egyptian");
    await translate(page);

    // Note: not asserting on the passage text here. ENGLISH_TEXT contains
    // "How are you today?", so that would match the textarea and pass whether
    // or not a translation ever ran.
    await expect(page.getByText("تعال نشرب قهوة معنا.")).toBeVisible();
    // An explicit pick has to override the default, or a learner studying with
    // Egyptian relatives keeps getting Gulf glosses.
    expect(backend.lastCallTo("translate-text")?.body).toMatchObject({ dialect: "Egyptian" });
  });

  test("shows a breakdown per sentence, natural and literal", async ({ page }) => {
    await page.goto("/translate");
    await translate(page);

    // Both readings, not just the fluent one: the literal is what makes the
    // English grammar visible, and it is the reason this page exists.
    await expect(page.getByText("How are you today?").first()).toBeVisible();
    await expect(page.getByText("شخبارك اليوم؟")).toBeVisible();
    await expect(page.getByText("كيف انت اليوم؟")).toBeVisible();
    await expect(page.getByText("Come have coffee with us.").first()).toBeVisible();
    await expect(page.getByText("تعال نشرب قهوة معنا.")).toBeVisible();
  });

  test("surfaces the idiom note when there is one", async ({ page }) => {
    await page.goto("/translate");
    await translate(page);

    await expect(page.getByText("تحية يومية بين الأصحاب.")).toBeVisible();
  });

  test("names the gloss dialect", async ({ page }) => {
    await page.goto("/translate");
    await translate(page);

    await expect(page.getByText("Glossed in Gulf")).toBeVisible();
  });

  test("refuses to call the model with nothing to translate", async ({ page, backend }) => {
    await page.goto("/translate");

    // The button is disabled rather than firing an empty request — each call
    // costs a model invocation and counts against the daily cap.
    await expect(page.getByRole("button", { name: /^translate$/i })).toBeDisabled();
    expect(backend.callsTo("translate-text")).toHaveLength(0);
  });

  test("refuses text past the length the model accepts", async ({ page, backend }) => {
    await page.goto("/translate");
    await page.getByRole("textbox").fill("a".repeat(4100));
    await page.getByRole("button", { name: /^translate$/i }).click();

    await expect(page.getByText(/too long/i)).toBeVisible();
    expect(backend.callsTo("translate-text")).toHaveLength(0);
  });

  test("fills the box from an example", async ({ page }) => {
    await page.goto("/translate");
    await page.getByRole("button", { name: /Email example/i }).click();

    await expect(page.getByRole("textbox")).not.toHaveValue("");
  });

  test("clears the text and the result together", async ({ page }) => {
    await page.goto("/translate");
    await translate(page);
    await expect(page.getByText("How are you today?").first()).toBeVisible();

    await page.getByRole("button", { name: /clear/i }).click();

    await expect(page.getByRole("textbox")).toHaveValue("");
    // Leaving the old breakdown on screen next to an empty box reads as a
    // translation of nothing.
    await expect(page.getByText("How are you today?")).toHaveCount(0);
  });
});

test.describe("when the translator fails", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("says so rather than rendering an empty breakdown", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("translate-text");

    await page.goto("/translate");
    await translate(page);

    await expect(page.getByText(/Glossed in/)).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveValue(ENGLISH_TEXT);
  });

  test("flattens the daily cap into a message that helps nobody", async ({ page, backend }) => {
    backend.stubFunctionCapped("translate-text");

    await page.goto("/translate");
    await translate(page);

    // Recording current behaviour. The function answers 429 with
    // { error: "daily_limit_reached", message, limit, upgrade_url } — an
    // actionable body — but useTranslateText rethrows supabase-js's
    // FunctionsHttpError before looking at it, so the learner is told "Edge
    // Function returned a non-2xx status code" and nothing about upgrading.
    //
    // src/lib/handleCapResponse.ts exists for exactly this and is wired into
    // three call sites; thirty-six edge functions enforce a cap. This test
    // fails once Translate is one of them.
    await expect(page.getByText(/non-2xx status code/i).first()).toBeVisible();
    await expect(page.getByText(/upgrade|pricing/i)).toHaveCount(0);
  });
});

test.describe("saving a translation", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    stubTranslate(backend);
    db.seed("saved_text_translations", []);
  });

  test("stores the source, the detected dialect and every sentence", async ({ page, db }) => {
    await page.goto("/translate");
    await translate(page);
    await page.getByRole("button", { name: /save translation/i }).click();

    await expect(page.getByRole("button", { name: /^saved$/i })).toBeVisible();

    const saved = db.rows("saved_text_translations")[0];
    expect(saved.user_id).toBe(TEST_USER_ID);
    expect(saved.source_text).toBe(ENGLISH_TEXT);
    expect(saved.detected_dialect).toBe("Gulf");
    // The sentences are the work; storing only the source would mean paying for
    // the model again to read it back.
    expect(saved.sentences).toHaveLength(2);
  });

  test("records the dialect as chosen, not as detected", async ({ page, db }) => {
    await page.goto("/translate");
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Yemeni" }).click();
    await translate(page);
    await page.getByRole("button", { name: /save translation/i }).click();
    await expect(page.getByRole("button", { name: /^saved$/i })).toBeVisible();

    const saved = db.rows("saved_text_translations")[0];
    expect(saved.source_dialect).toBe("Yemeni");
    expect(saved.detected_dialect).toBe("Gulf");
  });

  test("titles the entry from the text so the list is readable", async ({ page, db }) => {
    await page.goto("/translate");
    await translate(page);
    await page.getByRole("button", { name: /save translation/i }).click();
    await expect(page.getByRole("button", { name: /^saved$/i })).toBeVisible();

    expect(db.rows("saved_text_translations")[0].title).toBe(ENGLISH_TEXT);
  });

  test("will not save the same translation twice", async ({ page, db }) => {
    await page.goto("/translate");
    await translate(page);
    await page.getByRole("button", { name: /save translation/i }).click();
    await expect(page.getByRole("button", { name: /^saved$/i })).toBeVisible();

    // The button becomes an indicator once used; a second press would duplicate
    // the row with no way for the learner to tell them apart.
    await expect(page.getByRole("button", { name: /^saved$/i })).toBeDisabled();
    expect(db.rows("saved_text_translations")).toHaveLength(1);
  });

  test("is not reachable signed out at all", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/translate");

    // The page is behind ProtectedRoute, so the signed-out branches inside it —
    // the hidden save button, the hidden library link — are unreachable in
    // practice. Worth pinning: they read as live code paths.
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("says so when the save fails", async ({ page, db }) => {
    await page.goto("/translate");
    await translate(page);

    db.failWrites("saved_text_translations", 500);
    await page.getByRole("button", { name: /save translation/i }).click();

    await expect(page.getByText(/failed to save/i)).toBeVisible();
  });
});

test.describe("the saved-translations library", () => {
  const savedRow = (over: Record<string, unknown> = {}) => ({
    id: "cccccccc-0000-4000-8000-000000000001",
    user_id: TEST_USER_ID,
    title: "How are you today?",
    source_text: ENGLISH_TEXT,
    source_dialect: null,
    detected_dialect: "Gulf",
    sentences: TRANSLATION.sentences,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  });

  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("lists what was saved", async ({ page, db }) => {
    db.seed("saved_text_translations", [savedRow()]);
    await page.goto("/translate/saved");

    await expect(page.getByText("How are you today?").first()).toBeVisible();
    await expect(page.getByText(/2 sentences/)).toBeVisible();
  });

  test("opens one back up with its breakdown intact", async ({ page, db }) => {
    db.seed("saved_text_translations", [savedRow()]);
    await page.goto("/translate/saved");

    await page.getByText(/2 sentences/).click();

    // Reading a saved translation must not re-invoke the model; the whole
    // breakdown was stored for exactly this.
    await expect(page.getByText("شخبارك اليوم؟")).toBeVisible();
    await expect(page.getByText("كيف انت اليوم؟")).toBeVisible();
  });

  test("points an empty library at the translator", async ({ page, db }) => {
    db.seed("saved_text_translations", []);
    await page.goto("/translate/saved");

    await expect(page.getByText(/haven't saved any translations/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /translate something/i })).toBeVisible();
  });

  test("deletes only after the learner confirms", async ({ page, db }) => {
    db.seed("saved_text_translations", [savedRow()]);
    await page.goto("/translate/saved");

    await page.getByRole("button", { name: /delete saved translation/i }).click();
    await expect(page.getByText(/delete this saved translation/i)).toBeVisible();
    // Still there while the dialog is open — the confirmation is the point.
    expect(db.rows("saved_text_translations")).toHaveLength(1);

    await page.getByRole("button", { name: /^delete$/i }).click();
    await expect
      .poll(() => db.rows("saved_text_translations").length, { timeout: 10_000 })
      .toBe(0);
  });

  test("shows nothing belonging to another learner", async ({ page, db }) => {
    db.seed("saved_text_translations", [
      savedRow(),
      savedRow({
        id: "cccccccc-0000-4000-8000-000000000002",
        user_id: "00000000-0000-4000-8000-000000000009",
        title: "لغيري",
      }),
    ]);

    await page.goto("/translate/saved");

    await expect(page.getByText("How are you today?").first()).toBeVisible();
    await expect(page.getByText("لغيري")).toHaveCount(0);
  });
});

test.describe("tapping a word to save it", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    stubTranslate(backend);
    backend.stubFunction("translate-phrase", { translation: "قهوة" });
    db.seed("user_vocabulary", []);
  });

  test("looks the word up in its dialect, in context", async ({ page, backend }) => {
    await page.goto("/translate");
    await translate(page);

    await page.getByRole("button", { name: "coffee", exact: true }).click();

    await expect(page.getByText("قهوة", { exact: true })).toBeVisible();
    // A single-word lookup through the dialect-aware translator, not a
    // dictionary: the learner's dialect decides which Arabic comes back.
    expect(backend.lastCallTo("translate-phrase")?.body).toMatchObject({
      phrase: "coffee",
      dialect: "Gulf",
      mode: "word",
      direction: "en_to_ar",
    });
  });

  test("saves the word with the sentence it appeared in", async ({ page, db }) => {
    await page.goto("/translate");
    await translate(page);

    await page.getByRole("button", { name: "coffee", exact: true }).click();
    await expect(page.getByText("قهوة", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /save to my words/i }).click();

    await expect.poll(() => db.rows("user_vocabulary").length, { timeout: 10_000 }).toBe(1);

    const word = db.rows("user_vocabulary")[0];
    expect(word.word_english).toBe("coffee");
    expect(word.word_arabic).toBe("قهوة");
    // The sentence travels with the card, so the review shows the word in use
    // rather than stranded.
    expect(word.sentence_english).toBe("Come have coffee with us.");
    expect(word.source).toBe("translate-text");
  });

  test("still shows the breakdown when the lookup fails", async ({ page, backend }) => {
    backend.stubFunctionFailure("translate-phrase");

    await page.goto("/translate");
    await translate(page);
    await page.getByRole("button", { name: "coffee", exact: true }).click();

    // The gloss is best-effort; losing it must not take the sentence breakdown
    // down with it.
    await expect(page.getByText(/no translation available/i)).toBeVisible();
    await expect(page.getByText("How are you today?").first()).toBeVisible();
  });
});
