import { expect, test } from "./support/fixtures";
import {
  aListeningExercise,
  aVocabularyWord,
  listeningExerciseId,
  many,
  wordId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * Listening practice: three modes over the same synthesised audio.
 *
 * Dictation and speed ask the learner to type what they heard and compare it
 * to the source string; comprehension asks a multiple-choice question about it.
 * The comparison is the part worth pinning — it is an exact string match after
 * whitespace collapsing, so it is far stricter than a human marker would be,
 * and that strictness is invisible until you miss a single letter.
 *
 * Audio comes from `azure-tts` over raw `fetch` rather than
 * `functions.invoke`, so it is stubbed at the request level. A session is also
 * persisted to localStorage and resumed for four hours, which is its own class
 * of bug: resuming into a half-finished quiz that no longer matches the deck.
 */

const SESSION_KEY = "session_listening_practice";

const dictationCard = (page: Page) => page.getByText("Dictation", { exact: true });
const comprehensionCard = (page: Page) => page.getByText("Comprehension", { exact: true });
const speedCard = (page: Page) => page.getByText("Speed Drill", { exact: true });
const answerBox = (page: Page) => page.getByPlaceholder("اكتب هنا...");

/**
 * Wait for a function call to land.
 *
 * Picking a mode fires an async chain — read the pool, decide, then invoke —
 * so the click resolves well before the generator is asked for anything.
 */
async function awaitCall(
  backend: { callsTo: (name: string) => unknown[] },
  name: string,
): Promise<void> {
  await expect.poll(() => backend.callsTo(name).length).toBeGreaterThan(0);
}

/** Enough published exercises in `mode` for the pool to be used. */
function seedPool(db: MemoryDb, mode: string, count = 3, over: Record<string, unknown> = {}) {
  db.seed(
    "listening_exercises",
    many(aListeningExercise, count, (i) => ({
      id: listeningExerciseId(i),
      mode,
      audio_text: `جملة ${i}`,
      audio_text_english: `Sentence ${i}`,
      ...over,
    })),
  );
}

const aGeneratedQuiz = (over: Record<string, unknown> = {}) => ({
  questions: [
    {
      type: "dictation",
      audioText: "شلونك اليوم",
      audioTextEnglish: "How are you today",
    },
  ],
  ...over,
});

test.beforeEach(async ({ signInAs, db, page }) => {
  await signInAs("free");
  db.seed("listening_exercises", []);
  db.seed("vocabulary_words", []);
  // Azure TTS is reached with a bare fetch, not functions.invoke.
  await page.route("**/functions/v1/azure-tts", (route) =>
    route.fulfill({ status: 200, contentType: "audio/mpeg", body: Buffer.from([0, 1, 2, 3]) }),
  );
});

test.describe("choosing a mode", () => {
  test("offers the three modes and says what each is", async ({ page }) => {
    await page.goto("/listening");

    await expect(page.getByRole("heading", { name: /Listening Practice/ })).toBeVisible();
    await expect(page.getByText("Listen and type what you hear")).toBeVisible();
    await expect(page.getByText("Answer questions about what you hear")).toBeVisible();
  });
});

test.describe("where the questions come from", () => {
  test("prefers approved exercises for the chosen mode", async ({ page, db, backend }) => {
    seedPool(db, "dictation");

    await page.goto("/listening");
    await dictationCard(page).click();

    await expect(answerBox(page)).toBeVisible();
    expect(backend.callsTo("listening-quiz")).toHaveLength(0);
  });

  test("ignores exercises belonging to another mode", async ({ page, db, backend }) => {
    // Three comprehension exercises must not be served as dictation: the
    // question shape is different and the page would render an empty option
    // list.
    seedPool(db, "comprehension");
    db.seed("vocabulary_words", [aVocabularyWord({ id: wordId(0) })]);
    backend.stubFunction("listening-quiz", aGeneratedQuiz());

    await page.goto("/listening");
    await dictationCard(page).click();

    await awaitCall(backend, "listening-quiz");
    expect(backend.lastCallTo("listening-quiz")?.body).toMatchObject({ mode: "dictation" });
  });

  test("generates rather than using a pool of two", async ({ page, db, backend }) => {
    seedPool(db, "dictation", 2);
    backend.stubFunction("listening-quiz", aGeneratedQuiz());

    await page.goto("/listening");
    await dictationCard(page).click();

    // Two questions is not a session. Falling through beats a quiz that ends
    // before it starts.
    await awaitCall(backend, "listening-quiz");
    expect(backend.callsTo("listening-quiz")).toHaveLength(1);
  });

  test("ignores unpublished exercises", async ({ page, db, backend }) => {
    seedPool(db, "dictation", 5, { status: "draft" });
    backend.stubFunction("listening-quiz", aGeneratedQuiz());

    await page.goto("/listening");
    await dictationCard(page).click();

    await awaitCall(backend, "listening-quiz");
    expect(backend.callsTo("listening-quiz")).toHaveLength(1);
  });

  test("sends the mode, dialect and count when generating", async ({ page, db, backend }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), word_arabic: "باب", word_english: "door" }),
    ]);
    backend.stubFunction("listening-quiz", aGeneratedQuiz());

    await page.goto("/listening");
    await comprehensionCard(page).click();

    await awaitCall(backend, "listening-quiz");
    expect(backend.lastCallTo("listening-quiz")?.body).toMatchObject({
      mode: "comprehension",
      dialect: "Gulf",
      count: 5,
    });
  });

  test("says so and returns to the menu when nothing can be loaded", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Failed to load questions/]);
    backend.stubFunctionFailure("listening-quiz", 500, { error: "model unavailable" });

    await page.goto("/listening");
    await dictationCard(page).click();

    await expect(page.getByText("Failed to load questions. Please try again.")).toBeVisible();
    // Back at the menu rather than stranded on an empty quiz.
    await expect(page.getByText("Listen and type what you hear")).toBeVisible();
  });

  test("treats an empty generation as a failure", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/Failed to load questions/]);
    backend.stubFunction("listening-quiz", { questions: [] });

    await page.goto("/listening");
    await dictationCard(page).click();

    await expect(page.getByText("Failed to load questions. Please try again.")).toBeVisible();
  });
});

test.describe("dictation", () => {
  test.beforeEach(async ({ db, page }) => {
    seedPool(db, "dictation", 5);
    await page.goto("/listening");
    await dictationCard(page).click();
    await expect(answerBox(page)).toBeVisible();
  });

  test("gives the learner somewhere to type and nothing to read", async ({ page }) => {
    // The whole exercise is that the sentence is heard, not seen.
    await expect(answerBox(page)).toHaveValue("");
    await expect(page.getByRole("button", { name: /Check/ })).toBeVisible();
  });

  test("marks an exact answer right", async ({ page }) => {
    const expected = await page.evaluate(() => {
      const raw = localStorage.getItem("session_listening_practice");
      return raw ? JSON.parse(raw).data.questions[0].audioText : null;
    });

    await answerBox(page).fill(expected ?? "");
    await page.getByRole("button", { name: /Check/ }).click();

    await expect(page.getByText(/Correct/i).first()).toBeVisible();
  });

  test("forgives only extra whitespace", async ({ page }) => {
    const expected: string = await page.evaluate(() => {
      const raw = localStorage.getItem("session_listening_practice");
      return raw ? JSON.parse(raw).data.questions[0].audioText : "";
    });

    await answerBox(page).fill(`  ${expected.replace(/\s+/g, "   ")}  `);
    await page.getByRole("button", { name: /Check/ }).click();

    // Runs of spaces are collapsed and the ends trimmed — the only leniency
    // there is.
    await expect(page.getByText(/Correct/i).first()).toBeVisible();
  });

  test("marks a near-miss wrong with no partial credit", async ({ page }) => {
    const expected: string = await page.evaluate(() => {
      const raw = localStorage.getItem("session_listening_practice");
      return raw ? JSON.parse(raw).data.questions[0].audioText : "";
    });

    // Pinned, not fixed. The comparison is an exact string match, so one
    // missing letter — or a hamza, or a tashkeel mark the learner typed and the
    // source did not — scores the same as typing nothing at all. There is no
    // partial credit and no diff showing what was missed, which is most of what
    // a dictation exercise is for.
    await answerBox(page).fill(expected.slice(0, -1));
    await page.getByRole("button", { name: /Check/ }).click();

    await expect(page.getByText(expected).first()).toBeVisible();
    await expect(page.getByText(/Correct!/).first()).toHaveCount(0);
  });

  test("moves through the session and reports a score", async ({ page }) => {
    const complete = page.getByRole("heading", { name: "Session Complete!" });

    // Four Next clicks, then a fifth Check that ends the session — see the
    // pinned test below for why there is no fifth Next.
    for (let i = 0; i < 4; i++) {
      await answerBox(page).fill("something wrong");
      await page.getByRole("button", { name: /Check/ }).click();
      await page.getByRole("button", { name: /^Next/ }).click();
    }
    await answerBox(page).fill("something wrong");
    await page.getByRole("button", { name: /Check/ }).click();

    await expect(complete).toBeVisible();
    // Five wrong out of five: the score is reported, not hidden.
    await expect(page.getByText("0/5", { exact: false })).toBeVisible();
  });

  test("swallows the feedback on the very last answer", async ({ page }) => {
    for (let i = 0; i < 4; i++) {
      await answerBox(page).fill("something wrong");
      await page.getByRole("button", { name: /Check/ }).click();
      await page.getByRole("button", { name: /^Next/ }).click();
    }

    const expected: string = await page.evaluate(() => {
      const raw = localStorage.getItem("session_listening_practice");
      const data = raw ? JSON.parse(raw).data : null;
      return data ? data.questions[data.currentIndex].audioText : "";
    });

    await answerBox(page).fill("something wrong");
    await page.getByRole("button", { name: /Check/ }).click();

    // Pinned, not fixed. The completion screen renders on
    // `currentIndex >= questions.length - 1 && showResult`, which is the exact
    // condition Check sets on the last question — so pressing Check replaces
    // the result panel with the score screen. The learner never sees whether
    // the final answer was right, and never sees what the sentence actually
    // was. Every other question in the session shows both.
    await expect(page.getByRole("heading", { name: "Session Complete!" })).toBeVisible();
    await expect(page.getByText(expected)).toHaveCount(0);
    await expect(page.getByText(/Not quite|Correct!/)).toHaveCount(0);
  });
});

test.describe("comprehension", () => {
  test.beforeEach(async ({ db, page }) => {
    seedPool(db, "comprehension", 5, {
      questions: [
        { text: "بخير", correct: true },
        { text: "مع السلامة", correct: false },
      ],
    });
    await page.goto("/listening");
    await comprehensionCard(page).click();
  });

  test("offers the options rather than a text box", async ({ page }) => {
    await expect(page.getByRole("button", { name: "بخير" })).toBeVisible();
    await expect(answerBox(page)).toHaveCount(0);
  });

  test("marks the right option by highlighting it", async ({ page }) => {
    await page.getByRole("button", { name: "بخير" }).click();

    // Pinned. Comprehension gives no verbal feedback at all — no "Correct!",
    // no "Not quite", just a green border on the right option. A learner who
    // picked correctly and one who did not see the same green border in the
    // same place, and colour is the only thing distinguishing their answer
    // from the truth.
    await expect(page.getByRole("button", { name: "بخير" })).toHaveClass(/border-green-500/);
    await expect(page.getByText(/Correct!|Not quite/)).toHaveCount(0);
  });

  test("highlights the right option after a wrong choice too", async ({ page }) => {
    await page.getByRole("button", { name: "مع السلامة" }).click();

    await expect(page.getByRole("button", { name: "بخير" })).toHaveClass(/border-green-500/);
    await expect(page.getByRole("button", { name: "مع السلامة" })).not.toHaveClass(/border-green-500/);
  });

  test("takes no second answer", async ({ page }) => {
    await page.getByRole("button", { name: "بخير" }).click();

    await expect(page.getByRole("button", { name: "مع السلامة" })).toBeDisabled();
  });
});

test.describe("the speed round", () => {
  test.beforeEach(async ({ db, page }) => {
    seedPool(db, "speed", 5);
    await page.goto("/listening");
    await speedCard(page).click();
  });

  test("offers the playback speeds", async ({ page }) => {
    for (const label of ["0.7x", "1x", "1.25x", "1.5x"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

});

test("offers no speed control outside the speed round", async ({ page, db }) => {
  seedPool(db, "dictation", 5);

  await page.goto("/listening");
  await dictationCard(page).click();
  await expect(answerBox(page)).toBeVisible();

  // The speed multiplier is what the extra XP is paid for; exposing it
  // elsewhere would let a learner claim it for free.
  await expect(page.getByRole("button", { name: "1.5x" })).toHaveCount(0);
});

test.describe("resuming a session", () => {
  test("picks the quiz back up where it was left", async ({ page, db }) => {
    seedPool(db, "dictation", 5);

    await page.goto("/listening");
    await dictationCard(page).click();
    await answerBox(page).fill("something");
    await page.getByRole("button", { name: /Check/ }).click();
    await page.getByRole("button", { name: /Next|Finish|See Results/ }).click();

    await page.reload();

    // A reload mid-session — a phone locking, a tab restoring — should not cost
    // the learner the quiz.
    await expect(answerBox(page)).toBeVisible();
    await expect(page.getByText("Listen and type what you hear")).toHaveCount(0);
  });

  test("discards a session older than four hours", async ({ page, db }) => {
    seedPool(db, "dictation", 5);

    await page.goto("/listening");
    await page.evaluate((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          savedAt: Date.now() - 5 * 60 * 60 * 1000,
          data: {
            mode: "dictation",
            questions: [{ type: "dictation", audioText: "قديم", audioTextEnglish: "old" }],
            currentIndex: 0,
            speedRate: 1,
            score: 0,
            totalAnswered: 0,
          },
        }),
      );
    }, SESSION_KEY);
    await page.reload();

    // Yesterday's half-finished quiz is not what anyone means to resume.
    await expect(page.getByText("Listen and type what you hear")).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), SESSION_KEY)).toBeNull();
  });

  test("survives a corrupt saved session", async ({ page, db }) => {
    seedPool(db, "dictation", 5);

    await page.goto("/listening");
    await page.evaluate((key) => localStorage.setItem(key, "{not json"), SESSION_KEY);
    await page.reload();

    // The parse is wrapped, so a truncated write cannot brick the page.
    await expect(page.getByText("Listen and type what you hear")).toBeVisible();
  });
});
