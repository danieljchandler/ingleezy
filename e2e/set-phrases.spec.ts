import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * Set phrases — the fixed things English speakers say: greetings, small talk,
 * congratulations, apologies. The scenario arrives in the learner's dialect;
 * the phrase they produce is English.
 *
 * Two things distinguish this from the vocabulary decks. The material is
 * grouped by *occasion* rather than by topic, and it is answered by voice as
 * well as by tapping, so every question can be scored two ways and both write
 * to the same spaced-repetition row.
 *
 * That row is the interesting part: an answer fans out to three writes — the
 * FSRS update, an attempt log, and optionally saving the phrase — and only the
 * first affects when the learner sees the phrase again. These tests assert on
 * the row rather than the screen, because a review that scored right and
 * scheduled wrong looks identical at the moment it happens.
 *
 * The voice path is not driven here. The container's Chromium has a fake
 * capture device, so a recording would produce real silence and a real upload,
 * and the assertions would be about `MediaRecorder` rather than about the app.
 * The choice path exercises the same scoring, logging and scheduling writes.
 */

const OCCASION = "aaaaaaaa-2222-4000-8000-000000000000";
const PHRASE = "bbbbbbbb-2222-4000-8000-000000000000";

const anOccasion = (over: Record<string, unknown> = {}) => ({
  id: OCCASION,
  name: "Weddings",
  name_arabic: "الأعراس",
  slug: "weddings",
  description: null,
  icon_name: "heart",
  dialect: "Gulf",
  difficulty_floor: "beginner",
  display_order: 1,
  status: "published",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

/** One quiz question, in the shape `generate-set-phrase-quiz` returns. */
const aQuizItem = (over: Record<string, unknown> = {}) => ({
  phrase_id: PHRASE,
  question_type: "scenario",
  formality: "formal",
  is_due_review: false,
  occasion: { name: "Weddings", icon_name: "heart" },
  // The situation is in the learner's dialect; the production is English.
  prompt: { arabic: "وصلت عرس صديقك", english: null, audio_url: null },
  // Flat, not a nested `expected` object — the fields the answered panel reads.
  expected_english: "Congratulations!",
  expected_arabic: "مبروك",
  expected_transliteration: "كونقراتشوليشنز",
  expected_audio_url: null,
  cultural_note: null,
  choices: [
    { english: "Congratulations!", arabic: "مبروك", correct: true },
    { english: "My condolences.", arabic: "البقاء لله", correct: false },
  ],
  ...over,
});

function seedSetPhrases(db: MemoryDb, occasions = [anOccasion()]) {
  db.seed("set_phrase_occasions", occasions);
  db.seed("set_phrases", []);
  db.seed("user_set_phrases", []);
  db.seed("set_phrase_quiz_attempts", []);
}

test.describe("the hub", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("lists the occasions for the active dialect", async ({ page, db }) => {
    seedSetPhrases(db, [
      anOccasion({ name: "Weddings", dialect: "Gulf" }),
      anOccasion({
        id: "aaaaaaaa-2222-4000-8000-000000000001",
        name: "Egyptian condolences",
        dialect: "Egyptian",
      }),
    ]);

    await page.goto("/set-phrases");

    // These are the words said at somebody's funeral; the wrong dialect's are
    // not a near miss.
    await expect(page.getByRole("button", { name: /Weddings/ })).toBeVisible();
    await expect(page.getByText("الأعراس")).toBeVisible();
    await expect(page.getByText("Egyptian condolences")).toHaveCount(0);
  });

  test("hides an unpublished occasion", async ({ page, db }) => {
    seedSetPhrases(db, [
      anOccasion({ name: "Ready" }),
      anOccasion({
        id: "aaaaaaaa-2222-4000-8000-000000000002",
        name: "Draft occasion",
        status: "draft",
      }),
    ]);

    await page.goto("/set-phrases");

    await expect(page.getByRole("button", { name: /Ready/ })).toBeVisible();
    await expect(page.getByText("Draft occasion")).toHaveCount(0);
  });

  test("says so when a dialect has nothing seeded", async ({ page, db }) => {
    seedSetPhrases(db, []);

    await page.goto("/set-phrases");

    await expect(page.getByText(/No occasions yet for Gulf/)).toBeVisible();
  });

  test("offers no review when nothing is due", async ({ page, db }) => {
    seedSetPhrases(db);

    await page.goto("/set-phrases");

    // Zero due is the normal state; an enabled button leading to an empty
    // session is worse than a disabled one that says why.
    await expect(page.getByRole("button", { name: "Review (0)" })).toBeDisabled();
  });

  test("counts what is due for review", async ({ page, db }) => {
    seedSetPhrases(db);
    db.seed("set_phrases", [
      {
        id: PHRASE,
        phrase_arabic: "مبروك",
        phrase_english: "Congratulations",
        dialect: "Gulf",
        status: "published",
        occasion_id: OCCASION,
        difficulty: "beginner",
        formality: "formal",
        accepted_variants: [],
        cached_distractors: [],
        created_at: new Date().toISOString(),
      },
    ]);
    db.seed("user_set_phrases", [
      {
        id: "cccccccc-2222-4000-8000-000000000000",
        user_id: TEST_USER_ID,
        phrase_id: PHRASE,
        source: "reviewed",
        ease_factor: 2,
        difficulty: 5,
        interval_days: 1,
        repetitions: 1,
        next_review_at: new Date(Date.now() - 86_400_000).toISOString(),
        last_reviewed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        last_quality: 4,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    await page.goto("/set-phrases");

    await expect(page.getByRole("button", { name: "Review (1)" })).toBeEnabled();
  });

  test("starts a mixed session", async ({ page, db }) => {
    seedSetPhrases(db);

    await page.goto("/set-phrases");
    await page.getByRole("button", { name: /Mixed practice/ }).click();

    await expect(page).toHaveURL(/\/set-phrases\/practice$/);
  });

  test("starts a session for one occasion", async ({ page, db }) => {
    seedSetPhrases(db);

    await page.goto("/set-phrases");
    await page.getByRole("button", { name: /Weddings/ }).click();

    // The occasion travels in the query string and becomes the quiz's filter —
    // practising "weddings" has to mean weddings.
    await expect(page).toHaveURL(new RegExp(`occasion=${OCCASION}`));
  });
});

test.describe("a practice session", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    seedSetPhrases(db);
    backend.stubFunction("generate-set-phrase-quiz", { items: [aQuizItem()] });
  });

  test("asks for a batch and shows the first question", async ({ page, backend }) => {
    await page.goto("/set-phrases/practice");

    await expect(page.getByText("وصلت عرس صديقك")).toBeVisible();
    await expect(page.getByText("What do you say in English?")).toBeVisible();
    await expect(page.getByText("1 / 1")).toBeVisible();
    expect(backend.lastCallTo("generate-set-phrase-quiz")?.body).toMatchObject({ length: 8 });
  });

  test("narrows the batch to the occasion it was opened with", async ({ page, backend }) => {
    await page.goto(`/set-phrases/practice?occasion=${OCCASION}`);
    await expect(page.getByText("وصلت عرس صديقك")).toBeVisible();

    expect(backend.lastCallTo("generate-set-phrase-quiz")?.body).toMatchObject({
      occasionId: OCCASION,
    });
  });

  test("says so when there are no phrases to quiz on", async ({ page, backend }) => {
    backend.stubFunction("generate-set-phrase-quiz", { items: [] });

    await page.goto("/set-phrases/practice");

    await expect(page.getByText("No phrases ready yet.")).toBeVisible();
    await expect(page.getByText(/ask an admin to seed some/i)).toBeVisible();
  });

  test("reports a quiz that could not be built", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("generate-set-phrase-quiz");

    await page.goto("/set-phrases/practice");

    await expect(page.getByText("No phrases ready yet.")).toBeVisible();
  });

  test("keeps the choices hidden until the learner asks for them", async ({ page }) => {
    await page.goto("/set-phrases/practice");
    await expect(page.getByText("وصلت عرس صديقك")).toBeVisible();

    // The point of the exercise is producing the phrase, not recognising it;
    // showing four options up front turns it into a different, easier task.
    await expect(page.getByRole("button", { name: "Congratulations!" })).toHaveCount(0);

    await page.getByRole("button", { name: /choices/i }).click();
    await expect(page.getByRole("button", { name: "Congratulations!" })).toBeVisible();
  });

  test("marks a right answer and shows what was expected", async ({ page }) => {
    await page.goto("/set-phrases/practice");
    await page.getByRole("button", { name: /choices/i }).click();
    await page.getByRole("button", { name: "Congratulations!" }).click();

    // The answer card leads with the English and carries its phonetic_ar and
    // dialect gloss beneath.
    await expect(page.getByText("Correct answer:")).toBeVisible();
    await expect(page.getByText("كونقراتشوليشنز")).toBeVisible();
    await expect(page.getByText("مبروك", { exact: true })).toBeVisible();
  });

  test("schedules the phrase further out for a right answer", async ({ page, db }) => {
    await page.goto("/set-phrases/practice");
    await page.getByRole("button", { name: /choices/i }).click();
    await page.getByRole("button", { name: "Congratulations!" }).click();

    await expect.poll(() => db.rows("user_set_phrases").length).toBe(1);
    const row = db.rows("user_set_phrases")[0];
    expect(row).toMatchObject({ user_id: TEST_USER_ID, phrase_id: PHRASE, last_quality: 4 });
    // Quality 4 maps to "good", which is what moves the card forward. The
    // screen shows a tick either way; the schedule is the only place the
    // difference is recorded.
    expect(new Date(String(row.next_review_at)).getTime()).toBeGreaterThan(Date.now());
  });

  test("brings the phrase back sooner after a wrong answer", async ({ page, db }) => {
    await page.goto("/set-phrases/practice");
    await page.getByRole("button", { name: /choices/i }).click();
    await page.getByRole("button", { name: "My condolences." }).click();

    await expect.poll(() => db.rows("user_set_phrases").length).toBe(1);
    // Quality 1 is "again" — the whole reason a wrong answer is worth logging.
    expect(db.rows("user_set_phrases")[0].last_quality).toBe(1);
  });

  test("logs the attempt separately from the schedule", async ({ page, db }) => {
    await page.goto("/set-phrases/practice");
    await page.getByRole("button", { name: /choices/i }).click();
    await page.getByRole("button", { name: "Congratulations!" }).click();

    // Two different records with two different jobs: the schedule decides when
    // the learner sees this again, the attempt log is what tells an editor a
    // phrase is being missed by everyone.
    await expect.poll(() => db.rows("set_phrase_quiz_attempts").length).toBe(1);
    expect(db.rows("set_phrase_quiz_attempts")[0]).toMatchObject({
      phrase_id: PHRASE,
      question_type: "scenario",
      answer_mode: "choice",
      correct: true,
    });
  });

  test("records a wrong answer as an attempt too", async ({ page, db }) => {
    await page.goto("/set-phrases/practice");
    await page.getByRole("button", { name: /choices/i }).click();
    await page.getByRole("button", { name: "My condolences." }).click();

    await expect.poll(() => db.rows("set_phrase_quiz_attempts").length).toBe(1);
    expect(db.rows("set_phrase_quiz_attempts")[0]).toMatchObject({
      answer_mode: "choice",
      correct: false,
    });
  });

  test("saves a phrase from the session", async ({ page, db }) => {
    await page.goto("/set-phrases/practice");
    await page.getByRole("button", { name: /choices/i }).click();
    await page.getByRole("button", { name: "Congratulations!" }).click();

    await page.getByRole("button", { name: /Save/i }).click();

    // Upserted onto the same row the review just wrote, so saving a phrase you
    // have been quizzed on must not reset its schedule.
    await expect.poll(() => db.rows("user_set_phrases").length).toBe(1);
  });

  test("ends the session after the last question", async ({ page }) => {
    await page.goto("/set-phrases/practice");
    await page.getByRole("button", { name: /choices/i }).click();
    await page.getByRole("button", { name: "Congratulations!" }).click();
    await page.getByRole("button", { name: /Next|Finish|Done/i }).click();

    await expect(page.getByText("Session complete!")).toBeVisible();
    await expect(page).toHaveURL(/\/set-phrases$/);
  });

  test("moves through a longer batch one question at a time", async ({ page, backend }) => {
    backend.stubFunction("generate-set-phrase-quiz", {
      items: [
        aQuizItem({ prompt: { arabic: "الموقف الأول", english: null, audio_url: null } }),
        aQuizItem({
          phrase_id: "bbbbbbbb-2222-4000-8000-000000000001",
          prompt: { arabic: "الموقف الثاني", english: null, audio_url: null },
        }),
      ],
    });

    await page.goto("/set-phrases/practice");
    await expect(page.getByText("1 / 2")).toBeVisible();
    await page.getByRole("button", { name: /choices/i }).click();
    await page.getByRole("button", { name: "Congratulations!" }).first().click();
    await page.getByRole("button", { name: /Next|Finish|Done/i }).click();

    await expect(page.getByText("2 / 2")).toBeVisible();
    await expect(page.getByText("الموقف الثاني")).toBeVisible();
  });

  test("hides the choices again on the next question", async ({ page, backend }) => {
    backend.stubFunction("generate-set-phrase-quiz", {
      items: [
        aQuizItem({ prompt: { arabic: "الموقف الأول", english: null, audio_url: null } }),
        aQuizItem({
          phrase_id: "bbbbbbbb-2222-4000-8000-000000000001",
          prompt: { arabic: "الموقف الثاني", english: null, audio_url: null },
        }),
      ],
    });

    await page.goto("/set-phrases/practice");
    await page.getByRole("button", { name: /choices/i }).click();
    await page.getByRole("button", { name: "Congratulations!" }).first().click();
    await page.getByRole("button", { name: /Next|Finish|Done/i }).click();
    await expect(page.getByText("الموقف الثاني")).toBeVisible();

    // Carried over, the next question would open already answered-for.
    await expect(page.getByRole("button", { name: "Congratulations!" })).toHaveCount(0);
  });

  test("shows a reply prompt in English rather than as a scenario", async ({ page, backend }) => {
    backend.stubFunction("generate-set-phrase-quiz", {
      items: [
        aQuizItem({
          question_type: "reply",
          prompt: { english: "Thank you so much for your help", arabic: null, audio_url: null },
        }),
      ],
    });

    await page.goto("/set-phrases/practice");

    // Two question types share one screen: "here is a situation, what do you
    // say" and "someone said this to you in English, what do you say back".
    await expect(page.getByText("Reply to this:")).toBeVisible();
    await expect(page.getByText("Thank you so much for your help")).toBeVisible();
  });
});
