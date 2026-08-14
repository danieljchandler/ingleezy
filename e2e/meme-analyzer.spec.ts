import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * The meme analyser.
 *
 * A meme is the hardest thing in the app to explain, because almost none of it
 * is in the words: it is a caption, a shared reference, and a register that
 * only works if you already know it. So the output is deliberately two
 * explanations — a casual one and a cultural one — and the page refuses a
 * result carrying neither, even when the model returned 200.
 *
 * The two input types take different routes. An image is one base64 payload
 * straight to `analyze-meme`. A video is four extracted frames *plus* a
 * Deepgram pass over its audio, and that transcription is explicitly
 * best-effort: a meme with unintelligible audio should still be explained from
 * what is on screen.
 */

const anImage = (name = "meme.png") => ({
  name,
  mimeType: "image/png",
  // A 1×1 transparent PNG; nothing decodes it beyond `imageToBase64`.
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
});

// The meme is English. `english` is the caption as written and `arabic` is the
// gloss under it; the explanation is in the learner's dialect, because that is
// the language they are having the joke explained in.
const aResult = (over: Record<string, unknown> = {}) => ({
  memeExplanation: {
    casual: "الميم عن كره الصحيان بدري يوم الاثنين.",
    cultural: "أسبوع العمل بالغرب يبدأ الاثنين، فصار الاثنين نكتة ثابتة عندهم.",
  },
  onScreenText: {
    rawTranscriptArabic: "when you wake up early",
    lines: [
      {
        id: "line-0",
        english: "when you wake up early",
        arabic: "لما تصحى بدري",
        translation: "لما تصحى بدري",
        tokens: [],
      },
    ],
    vocabulary: [{ english: "wake up", arabic: "تصحى" }],
    grammarPoints: [],
  },
  ...over,
});

function seedMeme(db: MemoryDb) {
  db.seed("user_vocabulary", []);
}

/** Pick a file and wait for the page to take it. */
async function chooseImage(page: Page, file = anImage()) {
  await page.setInputFiles("input[type=file]", file);
  await expect(page.getByRole("button", { name: "حلّل الميم" })).toBeVisible();
}

test.describe("choosing something to analyse", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedMeme(db);
  });

  test("takes an image", async ({ page }) => {
    await page.goto("/meme");

    await page.setInputFiles("input[type=file]", anImage("joke.png"));

    await expect(page.getByRole("button", { name: "حلّل الميم" })).toBeVisible();
  });

  test("refuses a file that is neither image nor video", async ({ page }) => {
    await page.goto("/meme");

    await page.setInputFiles("input[type=file]", {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a meme"),
    });

    await expect(page.getByText("نوع ملف غير مدعوم")).toBeVisible();
    await expect(page.getByRole("button", { name: "حلّل الميم" })).toHaveCount(0);
  });

  test("refuses a dropped file of the wrong type too", async ({ page }) => {
    await page.goto("/meme");
    await expect(page.getByText("أفلت الميم هنا أو اضغط للرفع")).toBeVisible();

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["nope"], "notes.txt", { type: "text/plain" }));
      const zone = document.querySelector("div[class*='border-dashed']")!;
      zone.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
    });

    // Unlike Transcribe, the drop handler here repeats the same check the
    // picker makes rather than trusting the drop.
    await expect(page.getByText("نوع ملف غير مدعوم")).toBeVisible();
  });

  test("offers nothing to analyse before a file is chosen", async ({ page }) => {
    await page.goto("/meme");

    await expect(page.getByRole("button", { name: "حلّل الميم" })).toHaveCount(0);
  });

  test("offers no way to change the file before analysing", async ({ page }) => {
    await page.goto("/meme");
    await chooseImage(page);

    // Worth knowing: the only control that clears the selection is
    // "حلّل ميم ثاني", which renders with the *result*. Picking the
    // wrong image means analysing it — a paid vision call — before the page
    // will let you pick a different one.
    await expect(page.getByRole("button", { name: "حلّل ميم ثاني" })).toHaveCount(0);
    await expect(page.getByText("أفلت الميم هنا أو اضغط للرفع")).toHaveCount(0);
  });

  test("clears the file once a result is in", async ({ page, backend }) => {
    backend.stubFunction("analyze-meme", { success: true, result: aResult() });

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();
    await expect(page.getByText(/كره الصحيان بدري/)).toBeVisible();

    await page.getByRole("button", { name: "حلّل ميم ثاني" }).click();

    await expect(page.getByText("أفلت الميم هنا أو اضغط للرفع")).toBeVisible();
    await expect(page.getByText(/كره الصحيان بدري/)).toHaveCount(0);
  });
});

test.describe("analysing an image", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedMeme(db);
  });

  test("sends the image and says it is not a video", async ({ page, backend }) => {
    backend.stubFunction("analyze-meme", { success: true, result: aResult() });

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();

    await expect.poll(() => backend.lastCallTo("analyze-meme")?.body).toMatchObject({
      isVideo: false,
    });
  });

  test("transcribes nothing for a still image", async ({ page, backend }) => {
    backend.stubFunction("analyze-meme", { success: true, result: aResult() });

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();
    await expect(page.getByText(/كره الصحيان بدري/)).toBeVisible();

    // An image has no audio; a Deepgram call here would be a paid request for
    // a file with nothing in it.
    expect(backend.callsTo("deepgram-transcribe")).toHaveLength(0);
  });

  test("explains the joke twice over", async ({ page, backend }) => {
    backend.stubFunction("analyze-meme", { success: true, result: aResult() });

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();

    // Casual and cultural are different answers to different questions: what
    // it means, and why it is funny to the people sharing it.
    await expect(page.getByText(/كره الصحيان بدري/)).toBeVisible();
    await expect(page.getByText(/أسبوع العمل بالغرب/)).toBeVisible();
  });

  test("shows the caption and its translation", async ({ page, backend }) => {
    backend.stubFunction("analyze-meme", { success: true, result: aResult() });

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();

    await expect(page.getByRole("heading", { name: "النص المكتوب" })).toBeVisible();
    // The caption leads and the gloss sits under it: the learner is reading
    // the English, not the Arabic.
    await expect(page.getByText("when you wake up early")).toBeVisible();
    await expect(page.getByText("لما تصحى بدري").first()).toBeVisible();
  });

  test("lists the vocabulary English first", async ({ page, backend }) => {
    backend.stubFunction("analyze-meme", { success: true, result: aResult() });

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();

    // The English is the item being learned; the Arabic is what it means.
    await expect(page.getByText("wake up", { exact: true })).toBeVisible();
    await expect(page.getByText("تصحى", { exact: true })).toBeVisible();
  });
});

test.describe("analysing a video", () => {
  const aVideo = () => ({
    name: "meme.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("fake-video-bytes"),
  });

  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedMeme(db);
  });

  test("takes a video file", async ({ page }) => {
    await page.goto("/meme");
    await page.setInputFiles("input[type=file]", aVideo());

    await expect(page.getByRole("button", { name: "حلّل الميم" })).toBeVisible();
  });

  test("reports a video whose frames cannot be read", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunction("analyze-meme", { success: true, result: aResult() });

    await page.goto("/meme");
    await page.setInputFiles("input[type=file]", aVideo());
    await page.getByRole("button", { name: "حلّل الميم" }).click();

    // The video branch runs `extractFramesWithTimestamps` in the browser
    // before anything is sent, so a file Chromium cannot decode fails here and
    // the function is never called. That is the honest limit of this spec: a
    // real decodable video cannot be synthesised in a fixture, so the video
    // happy path is covered by the frames step's own behaviour rather than
    // end to end. What is asserted is that an unreadable file is *reported*
    // rather than silently producing an empty analysis.
    await expect(page.getByText("فشل التحليل")).toBeVisible();
    expect(backend.callsTo("analyze-meme")).toHaveLength(0);
  });
});

test.describe("when it cannot explain the meme", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedMeme(db);
  });

  test("refuses a result with no explanation and no text", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunction("analyze-meme", {
      success: true,
      result: {
        memeExplanation: { casual: "", cultural: "" },
        onScreenText: { rawTranscriptArabic: "", lines: [], vocabulary: [], grammarPoints: [] },
      },
    });

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();

    // `success: true` is not enough. A result with neither an explanation nor
    // a caption is a blank page dressed as an answer, and the learner is told
    // to try a clearer image rather than left looking at nothing.
    await expect(page.getByText(/ما قدرنا نطلع أي نص إنجليزي/)).toBeVisible();
  });

  test("accepts a result with only on-screen text", async ({ page, backend }) => {
    backend.stubFunction("analyze-meme", {
      success: true,
      result: {
        memeExplanation: { casual: "", cultural: "" },
        onScreenText: {
          rawTranscriptArabic: "when you wake up early",
          lines: [
            {
              id: "line-0",
              english: "when you wake up early",
              arabic: "لما تصحى بدري",
              translation: "لما تصحى بدري",
              tokens: [],
            },
          ],
          vocabulary: [],
          grammarPoints: [],
        },
      },
    });

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();

    // Either half is enough. A caption with no explanation is still a caption
    // the learner could not otherwise read.
    await expect(page.getByText("when you wake up early")).toBeVisible();
  });

  test("reports a refused analysis", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("analyze-meme");

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();

    await expect(page.getByText("فشل التحليل")).toBeVisible();
  });

  test("reports an in-band failure as one", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunction("analyze-meme", { success: false, error: "Image too small to read" });

    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();

    await expect(page.getByText("Image too small to read")).toBeVisible();
  });
});

test.describe("keeping a word from a meme", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    seedMeme(db);
    backend.stubFunction("analyze-meme", { success: true, result: aResult() });
  });

  async function analyse(page: Page) {
    await page.goto("/meme");
    await chooseImage(page);
    await page.getByRole("button", { name: "حلّل الميم" }).click();
    await expect(page.getByText(/كره الصحيان بدري/)).toBeVisible();
  }

  test("saves a word with the caption it came from", async ({ page, db }) => {
    await analyse(page);
    // The vocabulary row's save control is icon-only and unnamed — counted
    // against the app-wide icon-button baseline rather than worked around
    // silently.
    await page.locator("div").filter({ hasText: /^wake upتصحى$/ }).locator("xpath=..").getByRole("button").click();

    await expect.poll(() => db.rows("user_vocabulary").length).toBeGreaterThan(0);
    expect(db.rows("user_vocabulary")[0]).toMatchObject({
      user_id: TEST_USER_ID,
      // word_english is the word being learned; word_arabic its gloss. The
      // caption travels with it, English side and scaffold side both.
      word_english: "wake up",
      word_arabic: "تصحى",
      sentence_english: "when you wake up early",
      sentence_text: "لما تصحى بدري",
      source: "meme-analyzer",
    });
  });
});
