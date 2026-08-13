import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { Page } from "@playwright/test";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * Transcribe — the heaviest pipeline in the app.
 *
 * One click fans out to four independent ASR engines in parallel, optionally a
 * fifth call for on-screen text, then feeds whatever came back into an analyser.
 * The engines disagree on purpose: Deepgram is fastest, Munsit is best at
 * Arabic, Fanar and Soniox are budget-gated and routinely answer 200 with
 * `text: null`. So "the request succeeded" and "we got a transcript" are
 * different states, and almost every bug in a flow like this lives in the gap
 * between them.
 *
 * Two details are load-bearing and easy to break silently:
 *
 *  - the four engines are called with raw `fetch` and `FormData`, not
 *    `functions.invoke`, and each expects its file under a different part name
 *    (`audio` for three, `file` for Munsit). A part named wrongly gets a 400
 *    from the real function and nothing from a lenient one.
 *  - the engines are read for `text`, but the *flags* decide what reaches the
 *    analyser: Fanar's text is forwarded only when `fanarUsed`, Soniox's only
 *    when `sonioxUsed`. Dropping those checks would feed the analyser an
 *    engine's fallback output as though it were a real second opinion.
 */

/** A file the page will accept. The bytes are never decoded by anything here. */
const anAudioFile = (name = "clip.mp3") => ({
  name,
  mimeType: "audio/mpeg",
  buffer: Buffer.from("ID3fake-audio-bytes"),
});

const aVideoFile = (name = "clip.mp4") => ({
  name,
  mimeType: "video/mp4",
  buffer: Buffer.from("fake-video-bytes"),
});

/** Attach a file to the hidden picker and wait for the page to take it. */
async function chooseFile(page: Page, file = anAudioFile()) {
  await page.setInputFiles("#file-upload", file);
  await expect(page.getByRole("button", { name: "Start Transcription" })).toBeVisible();
}

/** The shape deepgram-transcribe returns on success. */
const deepgramSaid = (text: string) => ({ text, words: [] });

test.describe("reaching the page", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/transcribe");

    await expect(page).toHaveURL(/\/auth/);
  });

  test("lets a signed-in learner in", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/transcribe");

    await expect(page.getByRole("heading", { name: /Transcribe Audio/ })).toBeVisible();
  });
});

test.describe("what a learner may upload", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("offers no URL tab", async ({ page }) => {
    await page.goto("/transcribe");
    await expect(page.getByRole("tab", { name: "Upload File" })).toBeVisible();

    // Pulling media off YouTube and TikTok is an admin capability: it runs the
    // download-media function, which burns third-party API quota per call.
    await expect(page.getByRole("tab", { name: "URL" })).toHaveCount(0);
  });

  test("takes an audio file and shows what was picked", async ({ page }) => {
    await page.goto("/transcribe");
    await page.setInputFiles("#file-upload", anAudioFile("interview.mp3"));

    await expect(page.getByText("interview.mp3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Transcription" })).toBeVisible();
  });

  test("refuses a video file", async ({ page }) => {
    await page.goto("/transcribe");
    await page.setInputFiles("#file-upload", aVideoFile());

    await expect(page.getByText(/Video uploads are admin-only/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Transcription" })).toHaveCount(0);
  });

  test("refuses a file that is neither audio nor video", async ({ page }) => {
    await page.goto("/transcribe");
    await page.setInputFiles("#file-upload", {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not media"),
    });

    await expect(page.getByText(/Unsupported file type/i)).toBeVisible();
  });

  test("keeps no transcribe button before a file is chosen", async ({ page }) => {
    await page.goto("/transcribe");
    await expect(page.getByRole("tab", { name: "Upload File" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Start Transcription" })).toHaveCount(0);
  });

  test("drops the file again on clear", async ({ page }) => {
    await page.goto("/transcribe");
    await chooseFile(page);

    await page.getByText("clip.mp3").locator("xpath=../..").getByRole("button").click();

    await expect(page.getByText("Click or drag a file here")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Transcription" })).toHaveCount(0);
  });

  test("accepts a dropped file the picker would have rejected", async ({ page }) => {
    await page.goto("/transcribe");
    await expect(page.getByText("Click or drag a file here")).toBeVisible();

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["not media"], "notes.txt", { type: "text/plain" }));
      const zone = document.querySelector("div[class*='border-dashed']")!;
      zone.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
    });

    // Recording current behaviour, not endorsing it: `handleFileSelect` checks
    // the type allowlist and `handleDrop` does not, so the same .txt file is
    // refused through the button and accepted through the drop zone. It reaches
    // the engines and fails there instead, with a worse message.
    await expect(page.getByText("notes.txt")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Transcription" })).toBeVisible();
  });
});

test.describe("what an admin may upload", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("offers the URL tab", async ({ page }) => {
    await page.goto("/transcribe");

    await expect(page.getByRole("tab", { name: "URL" })).toBeVisible();
  });

  test("takes a video file", async ({ page }) => {
    await page.goto("/transcribe");
    // Waiting on the URL tab is waiting on `useAdminAuth` — see the race below.
    await expect(page.getByRole("tab", { name: "URL" })).toBeVisible();

    await page.setInputFiles("#file-upload", aVideoFile("reel.mp4"));

    await expect(page.getByText("reel.mp4")).toBeVisible();
    await expect(page.getByText(/admin-only/i)).toHaveCount(0);
  });

  test("refuses an admin's video while the admin check is still running", async ({ page, db }) => {
    db.delayRpc("has_role", 1500);

    await page.goto("/transcribe");
    await expect(page.getByText("Click or drag a file here")).toBeVisible();
    await page.setInputFiles("#file-upload", aVideoFile("reel.mp4"));

    // A race, pinned. `useAdminAuth` resolves over three `has_role` RPCs, and
    // the page renders the working upload control before they land while
    // holding `isAdmin` false. `adminLoading` is destructured at
    // Transcribe.tsx:177 and never read, so nothing disables the picker or
    // defers the check — an admin who picks a video quickly is told video is
    // admin-only, and the input is cleared underneath them. Reloading fixes it,
    // which is what makes it easy to dismiss as a glitch.
    await expect(page.getByText(/Video uploads are admin-only/i)).toBeVisible();
    await expect(page.getByText("reel.mp4")).toHaveCount(0);
  });

  test("rejects a URL that is not one", async ({ page }) => {
    await page.goto("/transcribe");
    await page.getByRole("tab", { name: "URL" }).click();
    await page.getByPlaceholder(/Paste a YouTube/).fill("not a url at all");
    await page.getByRole("button", { name: "Extract" }).click();

    await expect(page.getByText(/Please enter a valid URL/i)).toBeVisible();
  });

  test("pulls media down from a link and turns it into the upload", async ({ page, backend }) => {
    backend.stubFunction("download-media", {
      audioBase64: Buffer.from("downloaded-bytes").toString("base64"),
      contentType: "audio/mpeg",
      filename: "from-youtube.mp3",
      size: 17,
    });

    await page.goto("/transcribe");
    await page.getByRole("tab", { name: "URL" }).click();
    await page.getByPlaceholder(/Paste a YouTube/).fill("https://youtube.com/watch?v=abc123");
    await page.getByRole("button", { name: "Extract" }).click();

    // The URL path deliberately converges on the upload path rather than being
    // a second pipeline: the download becomes a File and everything downstream
    // is identical.
    await expect(page.getByText("from-youtube.mp3")).toBeVisible();
    expect(backend.lastCallTo("download-media")?.body).toMatchObject({
      url: "https://youtube.com/watch?v=abc123",
    });
  });

  test("logs the import with the platform it recognised", async ({ page, db, backend }) => {
    db.seed("content_import_logs", []);

    await page.goto("/transcribe");
    await page.getByRole("tab", { name: "URL" }).click();
    await page.getByPlaceholder(/Paste a YouTube/).fill("https://www.tiktok.com/@someone/video/1");
    await page.getByRole("button", { name: "Extract" }).click();

    await expect
      .poll(() => db.rows("content_import_logs").length, { timeout: 10_000 })
      .toBe(1);
    expect(db.rows("content_import_logs")[0]).toMatchObject({
      platform: "tiktok",
      user_id: TEST_USER_ID,
    });
  });

  test("reuses a cached transcription instead of transcribing again", async ({ page, backend }) => {
    backend.stubFunction("download-media", {
      cached: true,
      cacheAge: 3,
      processingEngines: ["Deepgram", "Munsit"],
      transcriptionData: {
        rawTranscriptArabic: "شلونك اليوم",
        lines: [],
        vocabulary: [],
        grammarPoints: [],
      },
    });

    await page.goto("/transcribe");
    await page.getByRole("tab", { name: "URL" }).click();
    await page.getByPlaceholder(/Paste a YouTube/).fill("https://youtube.com/watch?v=seen-before");
    await page.getByRole("button", { name: "Extract" }).click();

    await expect(page.getByText("شلونك اليوم")).toBeVisible();
    // The whole point of the cache is skipping the expensive part.
    expect(backend.callsTo("deepgram-transcribe")).toHaveLength(0);
  });

  test("reports a failed download rather than silently doing nothing", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/URL processing error/]);
    backend.stubFunctionFailure("download-media");

    await page.goto("/transcribe");
    await page.getByRole("tab", { name: "URL" }).click();
    await page.getByPlaceholder(/Paste a YouTube/).fill("https://youtube.com/watch?v=gone");
    await page.getByRole("button", { name: "Extract" }).click();

    await expect(page.getByText(/Failed to process URL/i)).toBeVisible();
  });
});

test.describe("running the engines", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("fires all four in parallel", async ({ page, backend }) => {
    backend.stubFunction("deepgram-transcribe", deepgramSaid("مرحبا"));

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();

    await expect(page.getByText("مرحبا")).toBeVisible();
    // Not a redundancy: they disagree, and the analyser is given all four so it
    // can arbitrate. Losing one quietly degrades the result rather than failing.
    expect(backend.callsTo("deepgram-transcribe")).toHaveLength(1);
    expect(backend.callsTo("munsit-transcribe")).toHaveLength(1);
    expect(backend.callsTo("fanar-transcribe")).toHaveLength(1);
    expect(backend.callsTo("soniox-transcribe")).toHaveLength(1);
  });

  test("names each file part the way its engine expects", async ({ page, backend }) => {
    backend.stubFunction("deepgram-transcribe", deepgramSaid("مرحبا"));

    await page.goto("/transcribe");
    await chooseFile(page, anAudioFile("lesson.mp3"));
    await page.getByRole("button", { name: "Start Transcription" }).click();
    await expect(page.getByText("مرحبا")).toBeVisible();

    // Munsit is the odd one out — it reads the part named `file`, and dispatches
    // its decoder on that part's filename. The other three read `audio`.
    expect(backend.lastCallTo("munsit-transcribe")?.body).toMatchObject({
      file: { filename: "lesson.mp3", type: "audio/mpeg" },
    });
    for (const engine of ["deepgram-transcribe", "fanar-transcribe", "soniox-transcribe"]) {
      expect(backend.lastCallTo(engine)?.body).toMatchObject({
        audio: { filename: "lesson.mp3" },
      });
    }
  });

  test("tells Soniox which dialect to bias towards", async ({ page, backend }) => {
    backend.stubFunction("deepgram-transcribe", deepgramSaid("مرحبا"));

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();
    await expect(page.getByText("مرحبا")).toBeVisible();

    // Soniox takes context biasing terms per dialect; sending the wrong one is
    // worse than sending none, because it biases towards the wrong vocabulary.
    expect(backend.lastCallTo("soniox-transcribe")?.body).toMatchObject({ dialect: "Gulf" });
  });

  test("prefers Deepgram when several engines answer", async ({ page, backend }) => {
    backend.stubFunction("deepgram-transcribe", deepgramSaid("من ديبجرام"));
    backend.stubFunction("munsit-transcribe", { text: "من منصت" });
    backend.stubFunction("soniox-transcribe", { text: "من سونيوكس", sonioxUsed: true, words: [] });

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();

    await expect(page.getByText("من ديبجرام")).toBeVisible();
  });

  test("falls through to Soniox, then Munsit, when Deepgram is silent", async ({
    page,
    backend,
  }) => {
    backend.stubFunction("deepgram-transcribe", { text: "", words: [] });
    backend.stubFunction("munsit-transcribe", { text: "من منصت" });
    backend.stubFunction("soniox-transcribe", { text: "من سونيوكس", sonioxUsed: true, words: [] });

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();

    // Order matters and is not alphabetical: Soniox sits above Munsit in the
    // fallback chain.
    await expect(page.getByText("من سونيوكس")).toBeVisible();
  });

  test("survives an engine that fails outright", async ({ page, backend }) => {
    backend.stubFunctionFailure("deepgram-transcribe");
    backend.stubFunction("munsit-transcribe", { text: "من منصت" });

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();

    // `Promise.allSettled`, not `Promise.all`. One dead engine must not take the
    // other three down with it.
    await expect(page.getByText("من منصت")).toBeVisible();
  });

  test("reports failure only when every engine came back empty", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Transcription error/]);
    backend.stubFunctionFailure("deepgram-transcribe");
    backend.stubFunctionFailure("munsit-transcribe");
    backend.stubFunctionFailure("fanar-transcribe");
    backend.stubFunctionFailure("soniox-transcribe");

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();

    await expect(page.getByText(/Transcription failed/i)).toBeVisible();
  });

  test("treats a 200 with no text as a failure too", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Transcription error/]);
    // Every engine answers politely and says nothing. This is the normal shape
    // of an unconfigured or out-of-budget engine, so it has to count as failure
    // rather than as an empty transcript the user is told to read.
    backend.stubFunction("deepgram-transcribe", { text: "", words: [] });
    backend.stubFunction("munsit-transcribe", { text: null });
    backend.stubFunction("fanar-transcribe", { text: null, fanarUsed: false });
    backend.stubFunction("soniox-transcribe", { text: null, sonioxUsed: false });

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();

    await expect(page.getByText(/Transcription failed/i)).toBeVisible();
  });
});

test.describe("handing the transcripts to the analyser", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  /**
   * Wait for the analyser to have been called, and answer with its body.
   *
   * The transcript on screen is not the signal to assert on: the page sets it
   * from the ASR result *before* awaiting the analyser, so the Arabic is
   * visible while `analyze-gulf-arabic` is still in flight. Reading the call
   * journal at that moment passes or fails on how loaded the machine is.
   */
  async function analyserBody(backend: SupabaseBackend) {
    await expect.poll(() => backend.callsTo("analyze-gulf-arabic").length).toBe(1);
    return backend.lastCallTo("analyze-gulf-arabic")?.body;
  }

  test("passes each engine's own transcript alongside the primary one", async ({
    page,
    backend,
  }) => {
    backend.stubFunction("deepgram-transcribe", deepgramSaid("من ديبجرام"));
    backend.stubFunction("munsit-transcribe", { text: "من منصت" });
    backend.stubFunction("fanar-transcribe", { text: "من فنار", fanarUsed: true, fanarAvailable: true });
    backend.stubFunction("soniox-transcribe", { text: "من سونيوكس", sonioxUsed: true, words: [] });

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();
    await expect(page.getByText("من ديبجرام")).toBeVisible();

    // The disagreement between engines is the signal the analyser arbitrates
    // on. Sending only the winner throws away the reason it was chosen.
    expect(await analyserBody(backend)).toMatchObject({
      transcript: "من ديبجرام",
      munsitTranscript: "من منصت",
      fanarTranscript: "من فنار",
      sonioxTranscript: "من سونيوكس",
      dialectModule: "Gulf",
    });
  });

  test("withholds Fanar's text when Fanar says it did not run", async ({ page, backend }) => {
    backend.stubFunction("deepgram-transcribe", deepgramSaid("من ديبجرام"));
    // Out of daily budget: it still answers 200, and the `text` it carries is
    // not a transcription of this audio.
    backend.stubFunction("fanar-transcribe", {
      text: "stale",
      fanarUsed: false,
      fanarAvailable: false,
      reason: "daily_limit_reached",
      budgetRemaining: 0,
    });

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();
    await expect(page.getByText("من ديبجرام")).toBeVisible();

    expect(await analyserBody(backend)).not.toHaveProperty("fanarTranscript");
  });

  test("withholds Soniox's text when Soniox says it did not run", async ({ page, backend }) => {
    backend.stubFunction("deepgram-transcribe", deepgramSaid("من ديبجرام"));
    backend.stubFunction("soniox-transcribe", {
      text: "stale",
      sonioxUsed: false,
      reason: "api_key_not_configured",
    });

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();
    await expect(page.getByText("من ديبجرام")).toBeVisible();

    expect(await analyserBody(backend)).not.toHaveProperty("sonioxTranscript");
  });

  test("shows the analysed sentences and vocabulary", async ({ page, backend }) => {
    backend.stubFunction("deepgram-transcribe", deepgramSaid("شلونك"));
    backend.stubFunction("analyze-gulf-arabic", {
      success: true,
      result: {
        rawTranscriptArabic: "شلونك",
        lines: [{ arabic: "شلونك", translation: "How are you" }],
        vocabulary: [{ arabic: "شلون", english: "how", transliteration: "shlon" }],
        grammarPoints: [],
        dialect: "Kuwaiti",
        difficulty: "Beginner",
      },
    });

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();

    await expect(page.getByText("How are you")).toBeVisible();
    await expect(page.getByText("Kuwaiti Arabic")).toBeVisible();
    await expect(page.getByText("Beginner")).toBeVisible();
  });

  test("keeps the raw transcript when the analysis fails", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Analysis error/]);
    backend.stubFunction("deepgram-transcribe", deepgramSaid("نص خام"));
    backend.stubFunction("analyze-gulf-arabic", { success: false, error: "ensemble unavailable" });

    await page.goto("/transcribe");
    await chooseFile(page);
    await page.getByRole("button", { name: "Start Transcription" }).click();

    // The expensive part already succeeded. Losing the transcript because the
    // optional second stage failed would waste the ASR spend and the wait.
    await expect(page.getByText(/Analysis failed/i)).toBeVisible();
    await expect(page.getByText("نص خام")).toBeVisible();
  });

  test("skips the visual pass for an audio-only file", async ({ page, backend }) => {
    backend.stubFunction("deepgram-transcribe", deepgramSaid("مرحبا"));

    await page.goto("/transcribe");
    await chooseFile(page, anAudioFile());
    await page.getByRole("button", { name: "Start Transcription" }).click();
    await expect(page.getByText("مرحبا")).toBeVisible();

    // Frame extraction on an audio file has nothing to look at, and the call
    // costs a vision-model request.
    expect(backend.callsTo("extract-visual-context")).toHaveLength(0);
  });
});

test.describe("saving what came back", () => {
  test.beforeEach(async ({ signInAs, backend }) => {
    await signInAs("free");
    backend.stubFunction("deepgram-transcribe", deepgramSaid("نص محفوظ"));
  });

  async function transcribe(page: Page) {
    await page.goto("/transcribe");
    await chooseFile(page, anAudioFile("my-clip.mp3"));
    await page.getByRole("button", { name: "Start Transcription" }).click();
    await expect(page.getByText("نص محفوظ")).toBeVisible();
  }

  test("offers the file's name as the default title", async ({ page }) => {
    await transcribe(page);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByPlaceholder("Transcription title...")).toHaveValue("my-clip");
  });

  test("writes the transcript, the dialect and the engines that produced it", async ({
    page,
    db,
  }) => {
    db.seed("saved_transcriptions", []);
    await transcribe(page);
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByPlaceholder("Transcription title...").fill("Market chat");
    await page.getByRole("button", { name: "Save", exact: true }).last().click();

    await expect.poll(() => db.rows("saved_transcriptions").length).toBe(1);
    const saved = db.rows("saved_transcriptions")[0];
    expect(saved).toMatchObject({
      user_id: TEST_USER_ID,
      title: "Market chat",
      raw_transcript_arabic: "نص محفوظ",
      dialect: "Gulf",
    });
    // Which engines ran is recorded with the result, so a transcript can be
    // judged later against the engines that produced it.
    expect((saved.engines_used as { asr: string[] }).asr).toEqual(["Deepgram"]);
  });

  test("marks the transcript as saved so it cannot be saved twice", async ({ page, db }) => {
    db.seed("saved_transcriptions", []);
    await transcribe(page);
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).last().click();

    await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  });

  test("stores an audio URL that will not survive the tab", async ({ page, db }) => {
    db.seed("saved_transcriptions", []);
    await transcribe(page);
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).last().click();

    await expect.poll(() => db.rows("saved_transcriptions").length).toBe(1);

    // Recording a bug rather than a behaviour. `audioUrl` is whatever
    // `URL.createObjectURL` minted for the uploaded File, and that is a handle
    // into this document's memory — it dies with the tab. Reopening the saved
    // transcription later reads the column straight back into the player
    // (Transcribe.tsx:242), so every saved row points at audio that no longer
    // resolves. Nothing uploads the media anywhere, so there is no URL that
    // would work; the column can only ever be null or dead.
    expect(String(db.rows("saved_transcriptions")[0].audio_url)).toMatch(/^blob:/);
  });

  test("reports a failed save instead of showing it as saved", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Save error/]);
    db.seed("saved_transcriptions", []);
    db.failAlways("saved_transcriptions", 500);
    await transcribe(page);
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).last().click();

    await expect(page.getByText(/Save failed/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Saved" })).toHaveCount(0);
  });
});

test.describe("reopening a saved transcription", () => {
  const SAVED_ID = "cccccccc-0000-4000-8000-000000000000";

  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("saved_transcriptions", [
      {
        id: SAVED_ID,
        user_id: TEST_USER_ID,
        title: "Souq haggling",
        raw_transcript_arabic: "بكم هذا",
        // Stored exactly as `saveTranscription` writes them: already through
        // `normalizeTranscriptResult`, so every line carries the `id` the
        // renderer keys on.
        lines: [{ id: "line-0", arabic: "بكم هذا", translation: "How much is this", tokens: [] }],
        vocabulary: [],
        grammar_points: [],
        cultural_context: null,
        audio_url: null,
        dialect: "Gulf",
        engines_used: { asr: ["Deepgram"] },
        created_at: new Date().toISOString(),
      },
    ]);
  });

  test("opens it from ?saved=", async ({ page }) => {
    await page.goto(`/transcribe?saved=${SAVED_ID}`);

    await expect(page.getByText("How much is this")).toBeVisible();
    await expect(page.getByText('Opened "Souq haggling"')).toBeVisible();
  });

  test("offers to save a transcription that is already saved", async ({ page }) => {
    await page.goto(`/transcribe?saved=${SAVED_ID}`);
    await expect(page.getByText("How much is this")).toBeVisible();

    // A bug, pinned. The loader sets `isSaved` (Transcribe.tsx:243) and an
    // effect keyed on `transcriptResult?.rawTranscriptArabic` immediately sets
    // it back to false (Transcribe.tsx:1059) — the loader populated the
    // transcript in the same batch, so the effect always fires straight after
    // and wins. The guard works on the path it was written for (saving what you
    // just transcribed leaves the transcript unchanged) and not on this one.
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Saved" })).toHaveCount(0);
  });

  test("saves a second copy of a transcription reopened from the library", async ({ page, db }) => {
    await page.goto(`/transcribe?saved=${SAVED_ID}`);
    await expect(page.getByText("How much is this")).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).last().click();

    // The consequence of the reset above. Nothing dedupes on the way in, so
    // opening a saved transcription and pressing the button it offers grows the
    // library by one every time.
    await expect.poll(() => db.rows("saved_transcriptions").length).toBe(2);
  });

  test("will not open another learner's transcription", async ({ page, db }) => {
    const THEIRS = "cccccccc-0000-4000-8000-000000000001";
    db.add("saved_transcriptions", {
      ...db.rows("saved_transcriptions")[0],
      id: THEIRS,
      user_id: "00000000-0000-4000-8000-0000000000ff",
      title: "Not yours",
      raw_transcript_arabic: "سر",
      lines: [{ id: "line-0", arabic: "سر", translation: "A secret", tokens: [] }],
    });

    await page.goto(`/transcribe?saved=${THEIRS}`);

    // The query filters on `user_id` as well as `id`. RLS would stop this in
    // production, but the client-side filter is what makes the page's own
    // behaviour correct rather than incidentally correct.
    await expect(page.getByText(/Couldn't load saved transcription/i)).toBeVisible();
    await expect(page.getByText("A secret")).toHaveCount(0);
  });

  test("renders a stored line the analyser would have thrown away", async ({ page, db }) => {
    const MALFORMED = "cccccccc-0000-4000-8000-000000000002";
    db.add("saved_transcriptions", {
      ...db.rows("saved_transcriptions")[0],
      id: MALFORMED,
      lines: [
        { id: "line-0", arabic: "بكم هذا", translation: "How much is this", tokens: [] },
        { id: "line-1", arabic: "", translation: "", tokens: [] },
      ],
    });

    await page.goto(`/transcribe?saved=${MALFORMED}`);
    await expect(page.getByText("How much is this")).toBeVisible();

    // An asymmetry worth knowing about. Every other producer of a transcript
    // runs `normalizeTranscriptResult`, which coerces the fields and drops
    // lines with no Arabic in them. The `?saved=` loader does not — it checks
    // `Array.isArray` and hands the JSON column straight to the renderer. The
    // column is untyped, so the empty line survives here and would not have
    // survived the path that produced it.
    await expect(page.getByText("2 sentences").first()).toBeVisible();
  });

  test("says so when the id does not resolve", async ({ page }) => {
    await page.goto("/transcribe?saved=cccccccc-0000-4000-8000-000000000009");

    await expect(page.getByText(/Couldn't load saved transcription/i)).toBeVisible();
  });
});
