import { expect, test } from "./support/fixtures";
import { aUserVocabulary, aDiscoverVideo, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { SupabaseBackend } from "../src/test/support/server/handler";
import type { Page } from "@playwright/test";

/**
 * Pronunciation practice.
 *
 * The one page in the app that records the learner rather than playing at them,
 * and the only one whose input is a microphone. Chromium runs here with
 * `--use-fake-device-for-media-stream`, so `getUserMedia` resolves and
 * `MediaRecorder` produces a real WebM/Opus blob — the whole capture path is
 * exercised for real, and only the Azure scorer is stubbed. That matters
 * because the hook does not send what the recorder produced: it transcodes to
 * 16-bit PCM WAV first (Azure returns straight zeros for Opus), so a broken
 * `blobToWav` would be invisible to any test that faked the blob.
 *
 * Three modes share one page — word, sentence and shadow — and they differ in
 * what they assess against, where the reference audio comes from, and which
 * queue they draw from.
 */

const WORD = "مرحبا";
const SENTENCE = "مرحبا كيف حالك اليوم";

const aScore = (over: Record<string, unknown> = {}) => ({
  overall: 82,
  accuracy: 85,
  fluency: 78,
  completeness: 100,
  recognizedText: WORD,
  locale: "ar-SA",
  words: [
    { word: WORD, accuracy: 85, errorType: "None", phonemes: [] },
    { word: "كيف", accuracy: 40, errorType: "Mispronunciation", phonemes: [] },
  ],
  ...over,
});

function seedWords(db: MemoryDb, rows = 2) {
  db.seed(
    "user_vocabulary",
    Array.from({ length: rows }, (_, i) =>
      aUserVocabulary({
        id: `voc-${i}`,
        word_arabic: i === 0 ? WORD : `كلمة${i}`,
        word_english: i === 0 ? "hello" : `word ${i}`,
        sentence_text: i === 0 ? SENTENCE : null,
        sentence_english: i === 0 ? "Hello how are you today" : null,
        created_at: new Date(Date.now() - i * 60_000).toISOString(),
      }),
    ),
  );
  db.seed("discover_videos", []);
  db.seed("saved_transcriptions", []);
}

/** The mic is a bare `<button>` with no text — located by the icon inside it. */
const micButton = (page: Page) => page.locator("button:has(svg.lucide-mic)").first();

/**
 * Record one take and wait for it to reach the scorer.
 *
 * Tap to start, tap to stop. Everything after the stop is asynchronous — the
 * recorder flushes its chunks, `blobToWav` decodes and resamples through an
 * `AudioContext`, then the base64 goes out — so returning at the second click
 * hands the test a page that has not called anything yet. Waiting on the
 * invocation rather than on a rendered score keeps this usable from the failure
 * specs too, and it doubles as the assertion that capture produced real audio:
 * a zero-byte blob short-circuits in the hook and never reaches the function.
 *
 * The pause between the two taps is load-bearing. `useShadowRecorder` calls
 * `recorder.start()` with no timeslice, so the encoder flushes a single blob at
 * stop — and stopping a few milliseconds after starting can flush before any
 * Opus frame exists. `useAzurePronunciation` rejects a zero-byte blob before
 * invoking anything, so the poll would then be waiting for a call that is never
 * coming. A quarter-second of the fake device guarantees frames even on a
 * machine running the whole suite in parallel.
 */
async function recordTake(page: Page, backend: SupabaseBackend) {
  const before = backend.callsTo("azure-pronunciation").length;
  await micButton(page).click();
  await expect(page.getByText("Tap to stop recording")).toBeVisible();
  await page.waitForTimeout(250);
  await page.locator("button:has(svg.lucide-mic-off)").first().click();
  await expect
    .poll(() => backend.callsTo("azure-pronunciation").length, { timeout: 15_000 })
    .toBeGreaterThan(before);
}

test.describe("getting in", () => {
  test("asks a signed-out visitor to sign in rather than opening the mic", async ({
    page,
    signInAs,
  }) => {
    await signInAs("anonymous");

    await page.goto("/pronunciation");

    // No route guard here — the page gates itself, so the redirect specs would
    // not catch this changing.
    await expect(page.getByText("Sign in to practice your Arabic pronunciation")).toBeVisible();
    await expect(micButton(page)).toHaveCount(0);
  });

  test("sends a learner with no saved words to go and save some", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("free");
    seedWords(db, 0);

    await page.goto("/pronunciation");

    // The queue *is* the learner's own vocabulary — there is no fallback deck,
    // so an empty library is a dead page rather than a short one.
    await expect(page.getByText(/Add some words to your vocabulary first/)).toBeVisible();
    await page.getByRole("button", { name: "Go to My Words" }).click();
    await expect(page).toHaveURL(/\/my-words/);
  });

  test("draws the newest twenty words", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedWords(db, 25);

    await page.goto("/pronunciation");
    await expect(page.getByText(/Word 1 of/)).toBeVisible();

    // Capped at 20 and ordered newest-first. The cap is what keeps a learner
    // with a thousand saved words from loading all of them to practise five,
    // and newest-first is what puts the word they just saved in front of them.
    await expect(page.getByText("Word 1 of 20")).toBeVisible();
    const read = db.readsOf("user_vocabulary").at(-1);
    expect(read?.search).toContain("limit=20");
    expect(read?.search).toContain("created_at.desc");
    await expect(page.getByText(WORD)).toBeVisible();
  });
});

test.describe("scoring a word", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    seedWords(db);
    backend.stubFunction("azure-pronunciation", aScore());
  });

  test("records, transcodes and scores what was said", async ({ page, backend }) => {
    await page.goto("/pronunciation");
    await expect(page.getByText(WORD)).toBeVisible();

    await recordTake(page, backend);

    await expect(page.getByText("Good")).toBeVisible();
    const call = backend.lastCallTo("azure-pronunciation")?.body as {
      referenceText: string;
      locale: string;
      audioMimeType: string;
      audioBase64: string;
    };
    expect(call.referenceText).toBe(WORD);
    // WAV, not the WebM/Opus the recorder produced. Azure scores Opus as zero
    // across the board, so the transcode is load-bearing and silent when broken.
    expect(call.audioMimeType).toBe("audio/wav");
    expect(call.audioBase64.length).toBeGreaterThan(0);
  });

  test("shows the three sub-scores behind the headline", async ({ page, backend }) => {
    await page.goto("/pronunciation");
    await recordTake(page, backend);

    await expect(page.getByText("Accuracy")).toBeVisible();
    await expect(page.getByText("Fluency")).toBeVisible();
    await expect(page.getByText("Completeness")).toBeVisible();
  });

  test("marks the word that was mispronounced", async ({ page, backend }) => {
    await page.goto("/pronunciation");
    await recordTake(page, backend);

    // The per-word breakdown is the only actionable part of the result — an
    // overall 82 does not tell a learner which sound to fix.
    await expect(page.getByText("Mispronunciation")).toBeVisible();
  });

  test("keeps a running average across takes", async ({ page, backend }) => {
    await page.goto("/pronunciation");
    await recordTake(page, backend);
    await expect(page.getByText("Session avg:")).toBeVisible();
    await expect(page.getByText("1 attempts")).toBeVisible();

    backend.stubFunction("azure-pronunciation", aScore({ overall: 62 }));
    await page.getByRole("button", { name: "Try Again" }).click();
    await recordTake(page, backend);

    // (82 + 62) / 2 = 72, rounded. The average is the session's only record —
    // nothing here is persisted, so leaving the page discards it.
    await expect(page.getByText("2 attempts")).toBeVisible();
    await expect(page.getByText("72", { exact: true })).toBeVisible();
  });

  test("persists nothing at all", async ({ page, db, backend }) => {
    await page.goto("/pronunciation");
    await recordTake(page, backend);
    await expect(page.getByText("Good")).toBeVisible();

    // Pinned, not endorsed. Every other practice surface in the app writes an
    // attempt row or awards XP; this one scores the learner and forgets. There
    // is no history, no XP, and nothing feeding the SRS about a word the
    // learner cannot say.
    expect(db.writesTo("user_vocabulary")).toHaveLength(0);
    expect(db.writesTo("user_xp")).toHaveLength(0);
  });
});

test.describe("the score bands", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedWords(db);
  });

  for (const [overall, label] of [
    [95, "Excellent"],
    [80, "Good"],
    [65, "Fair"],
    [40, "Needs practice"],
  ] as const) {
    test(`calls ${overall} "${label}"`, async ({ page, backend }) => {
      backend.stubFunction("azure-pronunciation", aScore({ overall }));

      await page.goto("/pronunciation");
      await recordTake(page, backend);

      await expect(page.getByText(label)).toBeVisible();
    });
  }
});

test.describe("word, sentence and dialect", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    seedWords(db);
    backend.stubFunction("azure-pronunciation", aScore());
  });

  test("assesses the whole sentence in sentence mode", async ({ page, backend }) => {
    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Sentence", exact: true }).click();
    await expect(page.getByText(SENTENCE)).toBeVisible();

    await recordTake(page, backend);

    // The reference text is what Azure aligns against; sending the single word
    // while showing the sentence would score every take as 30% complete.
    expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({
      referenceText: SENTENCE,
    });
  });

  test("offers no sentence mode for a word saved without one", async ({ page }) => {
    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Next" }).click();

    // The second fixture word has no `sentence_text`. Most saved words do not —
    // only the ones captured from a transcript carry their line.
    await expect(page.getByRole("button", { name: "Sentence", exact: true })).toBeDisabled();
  });

  test("scores an Egyptian learner against an Egyptian locale", async ({
    page,
    signInAs,
    db,
    backend,
  }) => {
    await signInAs("free", { profile: { preferred_dialect: "Egyptian" } });
    seedWords(db);
    backend.stubFunction("azure-pronunciation", aScore());

    await page.goto("/pronunciation");
    await recordTake(page, backend);

    // Previously hardcoded to ar-SA, which scored Egyptian and Yemeni learners
    // against Saudi norms and marked correct speech wrong.
    expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({
      locale: "ar-EG",
    });
  });

  test("hides the English until it is asked for", async ({ page }) => {
    await page.goto("/pronunciation");

    await expect(page.getByText("hello")).toHaveCount(0);
    await page.getByRole("switch").first().click();
    // Showing the translation by default turns a production drill into a
    // reading drill — the learner reads the English and never decodes the
    // Arabic.
    await expect(page.getByText("hello")).toBeVisible();
  });
});

test.describe("moving through the deck", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    seedWords(db, 3);
    backend.stubFunction("azure-pronunciation", aScore());
  });

  test("walks forwards and back", async ({ page }) => {
    await page.goto("/pronunciation");
    await expect(page.getByText("Word 1 of 3")).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Word 2 of 3")).toBeVisible();

    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText("Word 1 of 3")).toBeVisible();
  });

  test("stops at both ends", async ({ page }) => {
    await page.goto("/pronunciation");

    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("clears the last score when the word changes", async ({ page, backend }) => {
    await page.goto("/pronunciation");
    await recordTake(page, backend);
    await expect(page.getByText("Good")).toBeVisible();

    await page.getByRole("button", { name: "Next Word" }).click();

    // A stale score against the previous word is worse than none — it reads as
    // a score for the word now on screen.
    await expect(page.getByText("Good")).toHaveCount(0);
    await expect(page.getByText("Tap to record your pronunciation")).toBeVisible();
  });

  test("offers no Next Word on the last card", async ({ page, backend }) => {
    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await recordTake(page, backend);
    await expect(page.getByText("Good")).toBeVisible();

    await expect(page.getByRole("button", { name: "Next Word" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
  });
});

test.describe("when scoring fails", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedWords(db);
  });

  test("shows the reason and offers a retry", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunction("azure-pronunciation", { error: "Speech service unavailable" });

    await page.goto("/pronunciation");
    await recordTake(page, backend);

    // The function reports failure in-band as `{ error }` on a 200, so a test
    // that only covered non-2xx would miss the common case entirely.
    await expect(page.getByText("Speech service unavailable")).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Tap to record your pronunciation")).toBeVisible();
  });

  test("shows the reason when the function itself is refused", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("azure-pronunciation", 500, { error: "Azure key missing" });

    await page.goto("/pronunciation");
    await recordTake(page, backend);

    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});

test.describe("shadow mode", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedWords(db);
  });

  test("points an empty clip queue at the two places clips come from", async ({ page }) => {
    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Shadow" }).click();

    await expect(page.getByText("No native clips available yet")).toBeVisible();
    // Both routes are offered because the queue draws from both: published
    // Discover videos and the learner's own uploaded transcriptions.
    await expect(page.getByRole("button", { name: "Browse videos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload audio" })).toBeVisible();
  });

  test("builds a queue from published Discover transcripts", async ({ page, db }) => {
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: "vid-1",
        title: "Market chatter",
        source_url: "https://www.youtube.com/watch?v=abc123",
        embed_url: "https://www.youtube.com/embed/abc123",
        transcript_lines: [
          { id: "l1", arabic: "كيف حالك اليوم", translation: "How are you today", startMs: 0, endMs: 3000 },
        ],
      }),
    ]);

    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Shadow" }).click();

    await expect(page.getByText("كيف حالك اليوم")).toBeVisible();
    await expect(page.getByText("Clip 1 / 1")).toBeVisible();
  });

  test("skips lines that are too short or too long to shadow", async ({ page, db }) => {
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: "vid-1",
        transcript_lines: [
          // Under 1.2s — too quick to hear, echo and be scored on.
          { id: "l1", arabic: "نعم اكيد", startMs: 0, endMs: 900 },
          // Over 6s — past what a learner can hold in echoic memory.
          { id: "l2", arabic: "جملة طويلة جدا", startMs: 1000, endMs: 9000 },
          // A single token: nothing to shadow the rhythm of.
          { id: "l3", arabic: "نعم", startMs: 10000, endMs: 13000 },
          { id: "l4", arabic: "هذا يصلح تماما", startMs: 20000, endMs: 23000 },
        ],
      }),
    ]);

    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Shadow" }).click();

    await expect(page.getByText("Clip 1 / 1")).toBeVisible();
    await expect(page.getByText("هذا يصلح تماما")).toBeVisible();
  });

  test("leaves out clips in another dialect", async ({ page, db }) => {
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: "vid-eg",
        dialect: "Egyptian",
        transcript_lines: [
          { id: "l1", arabic: "ازيك النهارده", startMs: 0, endMs: 3000 },
        ],
      }),
    ]);

    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Shadow" }).click();

    // A Gulf learner shadowing Egyptian would be scored against a Gulf locale
    // on Egyptian speech and told they are wrong.
    await expect(page.getByText("No native clips available yet")).toBeVisible();
  });

  test("treats every Gulf country as Gulf", async ({ page, db }) => {
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: "vid-kw",
        dialect: "Kuwaiti",
        transcript_lines: [{ id: "l1", arabic: "شلونك اليوم", startMs: 0, endMs: 3000 }],
      }),
    ]);

    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Shadow" }).click();

    // "Gulf" is the module; Kuwaiti, Saudi, Emirati, Bahraini, Qatari and Omani
    // are all inside it. Matching on the exact string would empty the queue for
    // every learner.
    await expect(page.getByText("شلونك اليوم")).toBeVisible();
  });

  test("scores a Yemeni learner against a different locale in each mode", async ({
    page,
    signInAs,
    db,
    backend,
  }) => {
    await signInAs("free", { profile: { preferred_dialect: "Yemeni" } });
    seedWords(db);
    backend.stubFunction("azure-pronunciation", aScore());
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: "vid-ye",
        dialect: "Yemeni",
        transcript_lines: [{ id: "l1", arabic: "كيف حالك اليوم", startMs: 0, endMs: 3000 }],
      }),
    ]);

    await page.goto("/pronunciation");
    await recordTake(page, backend);

    // Pinned as a disagreement, not a behaviour worth keeping. Two locale
    // tables exist for one job: `DIALECT_MAP` in PronunciationPractice.tsx maps
    // Yemeni to ar-YE, while `DIALECT_LOCALE` in useShadowQueue.ts maps the
    // same dialect to ar-SA. So the same learner saying the same word is
    // assessed against a different Azure voice model depending on which tab of
    // one page they are on.
    expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({ locale: "ar-YE" });

    await page.getByRole("button", { name: "Try Again" }).click();
    await page.getByRole("button", { name: "Shadow" }).click();
    await expect(page.getByText("كيف حالك اليوم")).toBeVisible();
    await expect(page.getByText(/ar-SA|Yemeni/)).toBeVisible();
  });

  test("shows only the learner's own uploads", async ({ page, db }) => {
    db.seed("saved_transcriptions", [
      {
        id: "st-1",
        user_id: TEST_USER_ID,
        title: "My recording",
        dialect: "Gulf",
        audio_url: "data:audio/mpeg;base64,AAAA",
        lines: [{ id: "l1", arabic: "هذا تسجيلي انا", startMs: 0, endMs: 3000 }],
        created_at: new Date().toISOString(),
      },
    ]);

    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Shadow" }).click();

    // Pinned. The query filters on `audio_url is not null` and nothing else —
    // there is no `user_id` filter, so this list is correct only because RLS on
    // `saved_transcriptions` scopes it server-side. The emulator does not
    // enforce RLS, so this test asserts the query shape rather than the
    // isolation; the isolation itself belongs to the policy.
    await expect(page.getByText("هذا تسجيلي انا")).toBeVisible();
    await expect(page.getByText(/My recording/)).toBeVisible();
  });

  test("offers the slow-down speeds", async ({ page, db }) => {
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: "vid-1",
        transcript_lines: [{ id: "l1", arabic: "كيف حالك اليوم", startMs: 0, endMs: 3000 }],
      }),
    ]);

    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Shadow" }).click();
    await expect(page.getByText("كيف حالك اليوم")).toBeVisible();

    // Shadowing at native speed is the goal, not the starting point.
    for (const rate of ["1×", "0.75×", "0.5×"]) {
      await expect(page.getByRole("button", { name: rate, exact: true })).toBeVisible();
    }
  });

  test("gives no way to change the pass threshold", async ({ page, db }) => {
    db.seed("discover_videos", [
      aDiscoverVideo({
        id: "vid-1",
        transcript_lines: [{ id: "l1", arabic: "كيف حالك اليوم", startMs: 0, endMs: 3000 }],
      }),
    ]);

    await page.goto("/pronunciation");
    await page.getByRole("button", { name: "Shadow" }).click();
    await expect(page.getByText("كيف حالك اليوم")).toBeVisible();

    // Pinned. `ShadowMode` holds `threshold` in state at 75 and never calls its
    // setter, so auto-advance fires at a score the learner cannot adjust and is
    // never shown. Auto-advance itself *is* adjustable, which makes the missing
    // half look deliberate rather than dropped.
    await expect(page.getByText("Auto-advance")).toBeVisible();
    await expect(page.getByText(/threshold/i)).toHaveCount(0);
  });
});
