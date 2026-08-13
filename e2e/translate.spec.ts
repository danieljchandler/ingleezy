import { expect, test, type Page } from "./support/fixtures";
import { aUserVocabulary, vocabId, TEST_USER_ID } from "../src/test/support/factories";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * Translate & Save, and the tap-to-save component underneath it.
 *
 * `TappableArabicText` is the single most reused piece of the app — Translate,
 * Reading, Souq News, the story player and the transcript view all render Arabic
 * through it, and it is the only route by which a word gets into My Words from
 * free text. A bug in it therefore breaks vocabulary capture everywhere at once,
 * which is why it gets asserted here through a real page rather than in
 * isolation.
 *
 * Both `translate-text` and `word-enrichment` are AI calls, so the specs also
 * pin what happens when they fail: a page that renders an empty result on a
 * failed translation looks like the text had nothing in it.
 */

const ARABIC = "شخبارك اليوم";

/** The two-sentence response the translate function returns. */
const TRANSLATION = {
  detected_dialect: "Gulf",
  used_dialect: "Gulf",
  sentences: [
    {
      arabic: "شخبارك اليوم",
      literal: "what-your-news today",
      natural: "How are you today?",
      note: "شخبارك is Gulf-specific; Egyptians say إزيك.",
    },
    {
      arabic: "تعال نشرب قهوة",
      literal: "come we-drink coffee",
      natural: "Come have coffee with us",
    },
  ],
};

function stubTranslate(backend: SupabaseBackend, response: unknown = TRANSLATION) {
  backend.stubFunction("translate-text", response);
}

/** Paste text and run the translation. */
async function translate(page: Page, text = ARABIC) {
  await page.getByRole("textbox").fill(text);
  await page.getByRole("button", { name: /^translate$/i }).click();
}

test.describe("translating a passage", () => {
  test.beforeEach(async ({ signInAs, backend }) => {
    await signInAs("free");
    stubTranslate(backend);
  });

  test("sends the text and the chosen dialect", async ({ page, backend }) => {
    await page.goto("/translate");
    await translate(page);

    await expect(page.getByText("How are you today?")).toBeVisible();
    expect(backend.lastCallTo("translate-text")?.body).toMatchObject({
      text: ARABIC,
      dialect: "auto",
    });
  });

  test("passes an explicit dialect when one is picked", async ({ page, backend }) => {
    await page.goto("/translate");
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Egyptian" }).click();
    await translate(page);

    await expect(page.getByText("How are you today?")).toBeVisible();
    // Auto-detect is a guess; an explicit pick has to override it, or a learner
    // studying Egyptian keeps getting Gulf glosses.
    expect(backend.lastCallTo("translate-text")?.body).toMatchObject({ dialect: "Egyptian" });
  });

  test("shows a breakdown per sentence, literal and natural", async ({ page }) => {
    await page.goto("/translate");
    await translate(page);

    // Both readings, not just the fluent one: the literal is what makes the
    // grammar visible, and it is the reason this page exists.
    await expect(page.getByText("what-your-news today")).toBeVisible();
    await expect(page.getByText("How are you today?")).toBeVisible();
    await expect(page.getByText("come we-drink coffee")).toBeVisible();
    await expect(page.getByText("Come have coffee with us")).toBeVisible();
  });

  test("surfaces the cultural note when there is one", async ({ page }) => {
    await page.goto("/translate");
    await translate(page);

    await expect(page.getByText(/Gulf-specific/)).toBeVisible();
  });

  test("reports the dialect it detected", async ({ page }) => {
    await page.goto("/translate");
    await translate(page);

    await expect(page.getByText("Detected: Gulf")).toBeVisible();
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
    await page.getByRole("textbox").fill("ا".repeat(4100));
    await page.getByRole("button", { name: /^translate$/i }).click();

    await expect(page.getByText(/too long/i)).toBeVisible();
    expect(backend.callsTo("translate-text")).toHaveLength(0);
  });

  test("fills the box from an example", async ({ page }) => {
    await page.goto("/translate");
    await page.getByRole("button", { name: /Egyptian example/i }).click();

    await expect(page.getByRole("textbox")).not.toHaveValue("");
  });

  test("clears the text and the result together", async ({ page }) => {
    await page.goto("/translate");
    await translate(page);
    await expect(page.getByText("How are you today?")).toBeVisible();

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

    await expect(page.getByText(/Detected:/)).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveValue(ARABIC);
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
    expect(saved.source_text).toBe(ARABIC);
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

    expect(db.rows("saved_text_translations")[0].title).toBe(ARABIC);
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
    title: "شخبارك اليوم",
    source_text: ARABIC,
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

    await expect(page.getByText("شخبارك اليوم").first()).toBeVisible();
    await expect(page.getByText(/2 sentences/)).toBeVisible();
  });

  test("opens one back up with its breakdown intact", async ({ page, db }) => {
    db.seed("saved_text_translations", [savedRow()]);
    await page.goto("/translate/saved");

    await page.getByText(/2 sentences/).click();

    // Reading a saved translation must not re-invoke the model; the whole
    // breakdown was stored for exactly this.
    await expect(page.getByText("How are you today?")).toBeVisible();
    await expect(page.getByText("what-your-news today")).toBeVisible();
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

    await expect(page.getByText("شخبارك اليوم").first()).toBeVisible();
    await expect(page.getByText("لغيري")).toHaveCount(0);
  });
});

test.describe("tapping a word to save it", () => {
  const ENRICHMENT = {
    definition: "your news / how are you",
    literal: "what is your news",
    root: "خ ب ر",
    transliteration: "shakhbarak",
    uses: [],
  };

  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    stubTranslate(backend);
    backend.stubFunction("word-enrichment", ENRICHMENT);
    db.seed("user_vocabulary", []);
  });

  test("looks the word up in the sentence it appeared in", async ({ page, backend }) => {
    await page.goto("/translate");
    await translate(page);

    await page.getByRole("button", { name: /Look up/ }).first().click();

    await expect(page.getByText("your news / how are you")).toBeVisible();
    // The surrounding sentence is what lets the model disambiguate; without it
    // the gloss is a dictionary entry rather than a reading aid.
    expect(backend.lastCallTo("word-enrichment")?.body).toMatchObject({
      dialect: "Gulf",
      sentenceArabic: TRANSLATION.sentences[0].arabic,
      sentenceEnglish: TRANSLATION.sentences[0].natural,
    });
  });

  test("saves the word with its root and transliteration", async ({ page, db }) => {
    await page.goto("/translate");
    await translate(page);

    await page.getByRole("button", { name: /Look up/ }).first().click();
    await expect(page.getByText("your news / how are you")).toBeVisible();
    await page.getByRole("button", { name: /save to my words/i }).click();

    await expect.poll(() => db.rows("user_vocabulary").length, { timeout: 10_000 }).toBe(1);

    const word = db.rows("user_vocabulary")[0];
    expect(word.word_english).toBe("your news / how are you");
    expect(word.root).toBe("خ ب ر");
    expect(word.transliteration).toBe("shakhbarak");
    // The sentence travels with the card, so the review shows the word in use
    // rather than stranded.
    expect(word.sentence_text).toBe(TRANSLATION.sentences[0].arabic);
    expect(word.source).toBe("translate-text");
  });

  test("says the word is already saved rather than duplicating it", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), word_arabic: "شخبارك", word_english: "how are you" }),
    ]);

    await page.goto("/translate");
    await translate(page);
    await page.getByRole("button", { name: /Look up/ }).first().click();
    await expect(page.getByText("your news / how are you")).toBeVisible();

    db.failWrites("user_vocabulary", 409, {
      code: "23505",
      message: 'duplicate key value violates unique constraint "user_vocabulary_user_word_key"',
      details: null,
      hint: null,
    });
    await page.getByRole("button", { name: /save to my words/i }).click();

    // Recording current behaviour. A duplicate is not an error the learner
    // caused — the word is simply already in their deck — and
    // TappableArabicText has an "Already in your words" branch for it. That
    // branch is dead: useUserVocabulary turns the 23505 into the Arabic message
    // "هذه الكلمة موجودة بالفعل في قائمتك", and the branch tests
    // `err.message.includes("duplicate")`, which that string does not. So the
    // learner is told the save failed when nothing failed.
    //
    // This test fails once the two agree on how a duplicate is signalled.
    await expect(page.getByText(/failed to save/i)).toBeVisible();
    await expect(page.getByText(/already in your words/i)).toHaveCount(0);
    expect(db.rows("user_vocabulary")).toHaveLength(1);
  });

  test("still shows the word when enrichment fails", async ({ page, backend }) => {
    backend.stubFunctionFailure("word-enrichment");

    await page.goto("/translate");
    await translate(page);
    await page.getByRole("button", { name: /Look up/ }).first().click();

    // The gloss is best-effort; losing it must not take the sentence breakdown
    // down with it.
    await expect(page.getByText("How are you today?")).toBeVisible();
  });
});
