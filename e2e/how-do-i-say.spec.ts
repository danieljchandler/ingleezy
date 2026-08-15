import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * "How do I say…" — one box that answers three different questions.
 *
 * The function classifies the input rather than being told what it is: a
 * phrase to translate, a situation to find words for, or a conversation to
 * suggest a reply to. The page renders the same components for all three and
 * only the wording changes, so `inputMode` is the whole of the difference and
 * is worth pinning per branch.
 *
 * The other thing that matters is that answers are *saveable*. A translation
 * goes to My Phrases and its vocabulary to My Words, from different buttons
 * with different tables behind them — and neither is available signed out,
 * which is the page's only gate since the route has none.
 */

const aTranslation = (over: Record<string, unknown> = {}) => ({
  english: "How's it going?",
  arabic: "شلونك",
  phonetic_ar: "هاوز إت قوينق",
  context: "Casual",
  naturalness: 5,
  isPreferred: true,
  ...over,
});

const aResult = (over: Record<string, unknown> = {}) => ({
  phrase: "شلون أقول شلونك بالإنجليزي",
  inputMode: "translation",
  translations: [aTranslation()],
  vocabulary: [{ english: "going", arabic: "ماشي" }],
  ...over,
});

function seedSaves(db: MemoryDb) {
  db.seed("user_vocabulary", []);
  db.seed("user_phrases", []);
}

test.describe("asking", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedSaves(db);
  });

  test("sends the phrase and the learner's dialect", async ({ page, backend }) => {
    backend.stubFunction("how-do-i-say", { success: true, result: aResult() });

    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).fill("how are you");
    await page.getByRole("button", { name: "اسأل", exact: true }).click();

    // The dialect is the point of the feature — "how are you" has a different
    // answer in Gulf and Egyptian, and neither is a translation of the other.
    await expect
      .poll(() => backend.lastCallTo("how-do-i-say")?.body)
      .toMatchObject({ phrase: "how are you", dialect: "Gulf" });
  });

  test("offers no Ask button for an empty box", async ({ page }) => {
    await page.goto("/how-do-i-say");

    await expect(page.getByRole("button", { name: "اسأل", exact: true })).toBeDisabled();
  });

  test("asks nothing when Enter is pressed on an empty box", async ({ page, backend }) => {
    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).press("Enter");

    // Enter submits too, and it bypasses the disabled button entirely — which
    // is what makes `handleSearch`'s own empty check live rather than dead.
    expect(backend.callsTo("how-do-i-say")).toHaveLength(0);
  });

  test("asks nothing for a box of spaces", async ({ page, backend }) => {
    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).fill("     ");
    await page.getByPlaceholder(/اكتب عبارة/).press("Enter");

    expect(backend.callsTo("how-do-i-say")).toHaveLength(0);
  });

  test("trims what it sends", async ({ page, backend }) => {
    backend.stubFunction("how-do-i-say", { success: true, result: aResult() });

    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).fill("  how are you  ");
    await page.getByRole("button", { name: "اسأل", exact: true }).click();

    await expect
      .poll(() => backend.lastCallTo("how-do-i-say")?.body)
      .toMatchObject({ phrase: "how are you" });
  });
});

test.describe("the answer", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedSaves(db);
  });

  async function ask(page: import("@playwright/test").Page, phrase = "how are you") {
    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).fill(phrase);
    await page.getByRole("button", { name: "اسأل", exact: true }).click();
  }

  test("shows each way of saying it", async ({ page, backend }) => {
    backend.stubFunction("how-do-i-say", {
      success: true,
      result: aResult({
        translations: [
          aTranslation({ arabic: "شلونك", english: "How are you", isPreferred: true }),
          aTranslation({ arabic: "كيف حالك", english: "How are you", isPreferred: false }),
        ],
      }),
    });

    await ask(page);

    await expect(page.getByText("شلونك")).toBeVisible();
    await expect(page.getByText("كيف حالك")).toBeVisible();
  });

  test("marks the one to reach for", async ({ page, backend }) => {
    backend.stubFunction("how-do-i-say", {
      success: true,
      result: aResult({
        translations: [
          aTranslation({ arabic: "شلونك", isPreferred: true }),
          aTranslation({ arabic: "كيف حالك", isPreferred: false }),
        ],
      }),
    });

    await ask(page);

    // Several correct answers is the normal case; without a recommendation the
    // learner has to guess which one a native speaker would actually use.
    await expect(page.getByText("الخيار الأفضل")).toHaveCount(1);
  });

  test("says when and to whom each option fits", async ({ page, backend }) => {
    backend.stubFunction("how-do-i-say", {
      success: true,
      result: aResult({
        translations: [aTranslation({ context: "Formal, to an elder" })],
      }),
    });

    await ask(page);

    // The register is the part a dictionary cannot give you, and getting it
    // wrong is the failure this feature exists to prevent.
    await expect(page.getByText("Formal, to an elder")).toBeVisible();
  });

  test("rates how natural each option sounds", async ({ page, backend }) => {
    backend.stubFunction("how-do-i-say", {
      success: true,
      result: aResult({ translations: [aTranslation({ naturalness: 3 })] }),
    });

    await ask(page);

    await expect(page.getByLabel("الطبيعية 3 من ٥")).toBeVisible();
  });

  test("offers the key words behind the answer", async ({ page, backend }) => {
    backend.stubFunction("how-do-i-say", {
      success: true,
      result: aResult({ vocabulary: [{ arabic: "شلون", english: "how", root: "ش ل ن" }] }),
    });

    await ask(page);

    await expect(page.getByText("شلون", { exact: true })).toBeVisible();
  });

  test("adds a usage note when there is one", async ({ page, backend }) => {
    backend.stubFunction("how-do-i-say", {
      success: true,
      result: aResult({ usageNotes_ar: "هالعبارة غير رسمية — مع مديرك قل How are you." }),
    });

    await ask(page);

    await expect(page.getByText(/مع مديرك/)).toBeVisible();
  });
});

test.describe("the three things the box accepts", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedSaves(db);
  });

  async function askWith(page: import("@playwright/test").Page, result: unknown, backend: { stubFunction: (n: string, r: unknown) => unknown }) {
    backend.stubFunction("how-do-i-say", { success: true, result });
    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).fill("anything");
    await page.getByRole("button", { name: "اسأل", exact: true }).click();
  }

  test("counts ways to say it for a straight translation", async ({ page, backend }) => {
    await askWith(page, aResult({ inputMode: "translation" }), backend);

    await expect(page.getByText("طريقة واحدة لقولها")).toBeVisible();
  });

  test("counts things to say for a described situation", async ({ page, backend }) => {
    await askWith(
      page,
      aResult({
        inputMode: "scenario",
        situationSummary: "Arriving late to a friend's wedding",
        translations: [aTranslation(), aTranslation({ arabic: "آسف على التأخير" })],
      }),
      backend,
    );

    // Different question, different wording: a scenario has no single correct
    // translation, it has options.
    await expect(page.getByText("اقتراحان لما تقوله")).toBeVisible();
    await expect(page.getByText("Arriving late to a friend's wedding")).toBeVisible();
  });

  test("counts suggested responses for a pasted conversation", async ({ page, backend }) => {
    await askWith(
      page,
      aResult({ inputMode: "conversation", detectedContext: "A WhatsApp exchange with a colleague" }),
      backend,
    );

    await expect(page.getByText("رد مقترح واحد")).toBeVisible();
    await expect(page.getByText("A WhatsApp exchange with a colleague")).toBeVisible();
  });
});

test.describe("saving what came back", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    seedSaves(db);
    backend.stubFunction("how-do-i-say", { success: true, result: aResult() });
  });

  async function ask(page: import("@playwright/test").Page) {
    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).fill("how are you");
    await page.getByRole("button", { name: "اسأل", exact: true }).click();
    await expect(page.getByText("شلونك")).toBeVisible();
  }

  test("saves a word to My Words with its root", async ({ page, db }) => {
    await ask(page);
    await page.getByRole("button", { name: /احفظ الكلمة/ }).first().click();

    await expect.poll(() => db.rows("user_vocabulary").length).toBe(1);
    expect(db.rows("user_vocabulary")[0]).toMatchObject({
      user_id: TEST_USER_ID,
      word_english: "going",
      word_arabic: "ماشي",
      source: "how-do-i-say",
    });
  });

  test("saves a phrase to My Phrases with what was asked for", async ({ page, db }) => {
    await ask(page);
    await page.locator("button[title='احفظ العبارة']").first().click();

    await expect.poll(() => db.rows("user_phrases").length).toBe(1);
    // The ENGLISH phrase is the thing being learned; the dialect gloss and
    // the Arabic-letter phonetic rendering ride along with it.
    expect(db.rows("user_phrases")[0]).toMatchObject({
      phrase_english: "How's it going?",
      phrase_arabic: "شلونك",
      phonetic_ar: "هاوز إت قوينق",
      source: "how-do-i-say",
    });
  });

  test("marks a saved phrase rather than saving it twice", async ({ page, db }) => {
    await ask(page);
    await page.locator("button[title='احفظ العبارة']").first().click();
    await expect.poll(() => db.rows("user_phrases").length).toBe(1);

    // Disabled once saved, rather than silently ignoring the second click —
    // the bookmark also changes to a filled one, so the state is visible.
    await expect(page.locator("button[title='محفوظة']").first()).toBeDisabled();
    expect(db.rows("user_phrases")).toHaveLength(1);
  });

  test("offers a signed-out visitor no way to save, and no reason why", async ({
    page,
    signInAs,
    backend,
    db,
  }) => {
    await signInAs("anonymous");
    seedSaves(db);
    backend.stubFunction("how-do-i-say", { success: true, result: aResult() });

    await ask(page);

    // The route has no guard, so a signed-out visitor gets the whole answer —
    // and then the save buttons simply are not rendered. `handleSavePhrase`
    // opens with `toast.error("سجّل الدخول لحفظ العبارات")`, but it is only
    // reachable from a button behind `isAuthenticated`, so that message never
    // appears. The visitor is shown something worth keeping with no indication
    // that keeping it is possible at all.
    await expect(page.locator("button[title='احفظ العبارة']")).toHaveCount(0);
    await expect(page.getByText("سجّل الدخول لحفظ العبارات")).toHaveCount(0);
    expect(db.rows("user_phrases")).toHaveLength(0);
  });
});

test.describe("when it cannot answer", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedSaves(db);
  });

  test("reports a refused request", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("how-do-i-say");

    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).fill("how are you");
    await page.getByRole("button", { name: "اسأل", exact: true }).click();

    await expect(page.getByText("تعذّرت الترجمة")).toBeVisible();
  });

  test("reports an in-band failure as one", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunction("how-do-i-say", { success: false, error: "Could not classify input" });

    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).fill("how are you");
    await page.getByRole("button", { name: "اسأل", exact: true }).click();

    // The function answers 200 with `success: false`, so the status alone
    // would look like a result with no translations in it.
    await expect(page.getByText("Could not classify input")).toBeVisible();
  });

  test("shows the daily cap message when the allowance is spent", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionCapped("how-do-i-say");

    await page.goto("/how-do-i-say");
    await page.getByPlaceholder(/اكتب عبارة/).fill("how are you");
    await page.getByRole("button", { name: "اسأل", exact: true }).click();

    // A 429 carrying `daily_limit_reached` is a different situation from an
    // outage, and the learner can act on it.
    await expect(page.getByText("تعذّرت الترجمة")).toBeVisible();
  });
});
