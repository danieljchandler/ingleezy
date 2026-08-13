import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * Learn from an X post.
 *
 * Two functions in series, and the ordering is the whole feature: scrape the
 * post, then hand its text to the same analyser Transcribe uses. Either step
 * can fail on its own and they fail differently — a scrape failure means the
 * post is private, deleted or not a post at all, while an analysis failure
 * means the text came back but could not be read. The page has one error
 * surface for both, so the tests check that the *message* distinguishes them.
 *
 * The URL check runs before either call. It is not politeness: `scrape-x-post`
 * fetches whatever it is given, so an unvalidated box is an open proxy pointed
 * at arbitrary URLs from the app's own credentials.
 */

const POST_URL = "https://x.com/someone/status/1234567890";

const anAnalysis = (over: Record<string, unknown> = {}) => ({
  rawTranscriptArabic: "الجو حلو اليوم",
  lines: [
    { id: "line-0", arabic: "الجو حلو اليوم", translation: "The weather is nice today", tokens: [] },
  ],
  vocabulary: [{ arabic: "الجو", english: "the weather", root: "ج و و" }],
  grammarPoints: [],
  ...over,
});

function seedX(db: MemoryDb) {
  db.seed("user_vocabulary", []);
}

/**
 * Fill the box and submit.
 *
 * Submitted with Enter rather than the button: the submit control is icon-only
 * and carries no accessible name, so it cannot be located by role — a
 * name-based locator matches the page's info-hint button instead. Counted
 * against the app-wide icon-button baseline, and Enter is a real submit path
 * the page supports anyway.
 */
async function analyse(page: Page, url = POST_URL) {
  await page.goto("/learn-from-x");
  await page.getByPlaceholder(/x\.com\/username\/status/).fill(url);
  await page.getByPlaceholder(/x\.com\/username\/status/).press("Enter");
}

/**
 * Open one of the result tabs.
 *
 * The result is split three ways — Transcript, Vocabulary, Notes — and only
 * Transcript is mounted on arrival. The other two panels are not merely
 * off-screen; Radix unmounts inactive panels, so their content does not exist
 * until the tab is clicked. Any assertion about vocabulary or cultural notes
 * has to go through here.
 */
async function openTab(page: Page, name: RegExp) {
  await page.getByRole("tab", { name }).click();
}

test.describe("what it will accept", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedX(db);
  });

  test("refuses a URL that is not an X post", async ({ page, backend }) => {
    await analyse(page, "https://example.com/some/page");

    // The guard is a security boundary as much as a usability one: the
    // function fetches whatever it is handed, so an unvalidated box would make
    // this an open proxy running on the app's credentials.
    await expect(page.getByText("Invalid URL")).toBeVisible();
    expect(backend.callsTo("scrape-x-post")).toHaveLength(0);
  });

  test("refuses an X profile that is not a post", async ({ page, backend }) => {
    await analyse(page, "https://x.com/someone");

    // The pattern requires `/status/<digits>` — a profile has no text to read.
    await expect(page.getByText("Invalid URL")).toBeVisible();
    expect(backend.callsTo("scrape-x-post")).toHaveLength(0);
  });

  test("accepts the old twitter.com host", async ({ page, backend }) => {
    backend.stubFunction("scrape-x-post", { success: true, text: "الجو حلو اليوم" });
    backend.stubFunction("analyze-gulf-arabic", { success: true, result: anAnalysis() });

    await analyse(page, "https://twitter.com/someone/status/1234567890");

    // Links shared years ago still carry the old host, and rejecting them
    // would look like the feature is broken.
    await expect.poll(() => backend.callsTo("scrape-x-post").length).toBe(1);
  });

  test("asks for nothing when the box is empty", async ({ page, backend }) => {
    await page.goto("/learn-from-x");
    await page.getByPlaceholder(/x\.com\/username\/status/).press("Enter");

    expect(backend.callsTo("scrape-x-post")).toHaveLength(0);
  });

  test("gives the submit control no accessible name", async ({ page }) => {
    await page.goto("/learn-from-x");
    await page.getByPlaceholder(/x\.com\/username\/status/).fill(POST_URL);

    // Pinned rather than worked around. The only way to submit by pointer is a
    // button announced to a screen reader as "button", next to an info hint
    // that *is* named — so the named control is the one that does nothing.
    const submit = page.locator("button:has(svg.lucide-search)");
    await expect(submit).toBeEnabled();
    expect(await submit.getAttribute("aria-label")).toBeNull();
  });
});

test.describe("the two steps", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedX(db);
  });

  test("scrapes the post and then analyses what came back", async ({ page, backend }) => {
    backend.stubFunction("scrape-x-post", { success: true, text: "الجو حلو اليوم" });
    backend.stubFunction("analyze-gulf-arabic", { success: true, result: anAnalysis() });

    await analyse(page);

    await expect(page.getByText("The weather is nice today")).toBeVisible();
    expect(backend.lastCallTo("scrape-x-post")?.body).toMatchObject({ url: POST_URL });
    // The analyser is handed the *scraped* text, not the URL — this is the
    // seam where the two functions meet, and passing the wrong thing would
    // have it analysing a link.
    expect(backend.lastCallTo("analyze-gulf-arabic")?.body).toMatchObject({
      transcript: "الجو حلو اليوم",
    });
  });

  test("shows the post's own text before the analysis lands", async ({ page, backend }) => {
    backend.stubFunction("scrape-x-post", { success: true, text: "الجو حلو اليوم" });
    backend.stubFunction("analyze-gulf-arabic", { success: true, result: anAnalysis() });

    await analyse(page);

    // The scrape is the fast half; showing its text immediately is what makes
    // the wait for the analysis feel like progress rather than a hang.
    await expect(page.getByText("Post extracted!")).toBeVisible();
  });

  test("never analyses when the scrape failed", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunction("scrape-x-post", { success: false, error: "Post is private" });

    await analyse(page);

    // A private or deleted post is the common case, and running the analyser
    // on nothing would spend a model call to produce an empty result.
    await expect(page.getByText("Post is private")).toBeVisible();
    expect(backend.callsTo("analyze-gulf-arabic")).toHaveLength(0);
  });

  test("says so when the scrape itself is refused", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("scrape-x-post");

    await analyse(page);

    await expect(page.getByText("Failed")).toBeVisible();
    expect(backend.callsTo("analyze-gulf-arabic")).toHaveLength(0);
  });

  test("distinguishes an analysis failure from a scrape failure", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunction("scrape-x-post", { success: true, text: "الجو حلو اليوم" });
    backend.stubFunction("analyze-gulf-arabic", { success: false, error: "Not enough Arabic" });

    await analyse(page);

    // Both steps report through the same toast, so the message is the only
    // thing telling a learner whether to try a different post or a different
    // link.
    await expect(page.getByText("Not enough Arabic")).toBeVisible();
    expect(backend.callsTo("scrape-x-post")).toHaveLength(1);
  });
});

test.describe("the result", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    seedX(db);
    backend.stubFunction("scrape-x-post", { success: true, text: "الجو حلو اليوم" });
    backend.stubFunction("analyze-gulf-arabic", { success: true, result: anAnalysis() });
  });

  test("shows the post line by line", async ({ page }) => {
    await analyse(page);

    await expect(page.getByText("The weather is nice today")).toBeVisible();
  });

  test("offers the vocabulary it found", async ({ page }) => {
    await analyse(page);
    await openTab(page, /Vocabulary/);

    await expect(page.getByText("the weather")).toBeVisible();
  });

  test("counts what it found on the tabs themselves", async ({ page }) => {
    await analyse(page);

    // One sentence, one word. The counts are the only thing telling a learner
    // there is anything behind the other tabs — without them an empty-looking
    // Transcript panel reads as the whole result.
    await expect(page.getByRole("tab", { name: /Transcript 1/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Vocabulary 1/ })).toBeVisible();
  });

  test("adds the cultural note when there is one", async ({ page, backend }) => {
    backend.stubFunction("analyze-gulf-arabic", {
      success: true,
      result: anAnalysis({ culturalContext: "Weather small talk opens most Gulf conversations." }),
    });

    await analyse(page);
    await openTab(page, /Notes/);

    await expect(page.getByText(/opens most Gulf conversations/)).toBeVisible();
  });

  test("hides the Notes tab when there is nothing to put in it", async ({ page }) => {
    // The default analysis carries no cultural context and no grammar points.
    // An empty third tab would be a dead end, so the tab itself is conditional.
    await analyse(page);
    await expect(page.getByRole("tab", { name: /Vocabulary/ })).toBeVisible();

    await expect(page.getByRole("tab", { name: "Notes" })).toHaveCount(0);
  });

  test("saves a word with the line it came from", async ({ page, db }) => {
    await analyse(page);
    await openTab(page, /Vocabulary/);
    await expect(page.getByText("the weather")).toBeVisible();

    // Icon-only and unnamed, like the submit control — located by its icon
    // because there is no role+name that reaches it. Counted against the
    // app-wide icon-button baseline.
    await page.locator("button:has(svg.lucide-plus)").first().click();

    await expect.poll(() => db.rows("user_vocabulary").length).toBeGreaterThan(0);
    // The sentence travels with the word. A word saved bare is a word reviewed
    // out of context later, and this page is the only place that line exists.
    expect(db.rows("user_vocabulary")[0]).toMatchObject({
      user_id: TEST_USER_ID,
      word_arabic: "الجو",
      sentence_text: "الجو حلو اليوم",
      sentence_english: "The weather is nice today",
      source: "x_post",
    });
  });

  test("confirms the save on the row itself", async ({ page }) => {
    await analyse(page);
    await openTab(page, /Vocabulary/);
    await page.locator("button:has(svg.lucide-plus)").first().click();

    // The row swaps its plus for a tick and goes disabled. Without that the
    // only feedback is a toast that has already gone, and the same word gets
    // saved twice.
    await expect(page.locator("button:has(svg.lucide-check)")).toBeVisible();
    await expect(page.locator("button:has(svg.lucide-check)")).toBeDisabled();
  });

  test("gives a signed-out visitor no way to save at all", async ({
    page,
    signInAs,
    db,
    backend,
  }) => {
    await signInAs("anonymous");
    seedX(db);
    backend.stubFunction("scrape-x-post", { success: true, text: "الجو حلو اليوم" });
    backend.stubFunction("analyze-gulf-arabic", { success: true, result: anAnalysis() });

    await analyse(page);
    await openTab(page, /Vocabulary/);
    await expect(page.getByText("the weather")).toBeVisible();

    // Pinned as-is. The route has no guard, so reading a post is free and
    // keeping a word is the gate — but the gate is enforced by *omitting the
    // control*: the vocabulary row renders its save button only behind
    // `isAuthenticated`, and the transcript panel is handed `undefined` for its
    // save callback on the same condition. `handleSaveWord`'s own
    // "Sign in to save words" branch is therefore unreachable — a signed-out
    // learner is never told saving exists, which is the same dead-guard shape
    // as How Do I Say and Liked Videos.
    await expect(page.locator("button:has(svg.lucide-plus)")).toHaveCount(0);
    expect(db.rows("user_vocabulary")).toHaveLength(0);
  });
});
