import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * Grammar drills — five multiple-choice questions and a mastery ladder behind
 * them.
 *
 * Two things make this more than a quiz. First, the questions come from one of
 * two places: a pool of human-approved rows in `grammar_exercises`, or a live
 * AI generation if fewer than three approved ones exist. The threshold matters
 * — a drill built from one approved question and nothing else would be a worse
 * experience than one generated fresh, so partially-seeded categories fall all
 * the way through rather than part of the way.
 *
 * Second, the round is *sent* somewhere. `outcomes` is an ordered list of
 * hits and misses, submitted once at the end so the next drill can be aimed at
 * what the learner keeps missing. Order is kept deliberately rather than
 * derived from the score, so a round is not interchangeable with its total.
 */

// The table keeps its Arabic-era column names; the CONTENT is flipped —
// question_english carries the English drill sentence (primary),
// question_arabic the dialect instruction line, explanation the dialect
// explanation. The page normalizes both old and new key spellings.
const anExercise = (index: number, over: Record<string, unknown> = {}) => ({
  id: `aaaaaaaa-1111-4000-8000-00000000000${index}`,
  question_english: `He ___ to work number ${index}.`,
  question_arabic: `اختر الشكل الصحيح ${index}`,
  grammar_point: "Present tense",
  category: "verb-conjugation",
  difficulty: "beginner",
  choices: [
    { text: `goes ${index}`, text_ar: `صح ${index}` },
    { text: `go ${index}`, text_ar: `خطأ ${index}` },
  ],
  correct_index: 0,
  explanation: `لأن السبب ${index}`,
  status: "published",
  dialect: "Gulf",
  session_id: null,
  created_by: TEST_USER_ID,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

function seedApproved(db: MemoryDb, count: number) {
  db.seed(
    "grammar_exercises",
    Array.from({ length: count }, (_, i) => anExercise(i)),
  );
  db.seed("user_concept_mastery", []);
  db.seed("curriculum_concepts", []);
}

/** Answer the current question correctly and move on. */
async function answerCorrectly(page: Page) {
  await page.getByRole("button", { name: /goes/ }).click();
  await page.getByRole("button", { name: /التالي|النتائج/ }).click();
}

async function answerWrongly(page: Page) {
  await page.getByRole("button", { name: /go \d/ }).click();
  await page.getByRole("button", { name: /التالي|النتائج/ }).click();
}

test.describe("reaching the drills", () => {
  test("asks a signed-out visitor to sign in, in place", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/grammar");

    await expect(page.getByText("سجّل الدخول للتدرب على القواعد")).toBeVisible();
  });

  test("offers every grammar category to a learner", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedApproved(db, 5);

    await page.goto("/grammar");

    for (const label of [
      "Articles",
      "Verb Tenses",
      "Prepositions",
      "Pronouns",
      "Negation",
      "Possessives",
      "Question Forms",
      "Sentence Structure",
    ]) {
      await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
  });
});

test.describe("where the questions come from", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("uses approved questions when there are enough of them", async ({ page, db, backend }) => {
    seedApproved(db, 5);

    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();

    await expect(page.getByText("سؤال 1 من 5")).toBeVisible();
    // Reviewed content costs nothing per drill and has been checked by a human;
    // generating over the top of it would be paying to do worse.
    expect(backend.callsTo("grammar-drill")).toHaveLength(0);
  });

  test("generates fresh questions when the approved pool is too thin", async ({
    page,
    db,
    backend,
  }) => {
    seedApproved(db, 2);
    backend.stubFunction("grammar-drill", {
      questions: [
        {
          question: "A generated question ___.",
          question_ar: "سؤال مولّد",
          grammar_point: "Present tense",
          choices: [
            { text: "goes", text_ar: "صح" },
            { text: "go", text_ar: "خطأ" },
          ],
          correct_index: 0,
          explanation_ar: "شرح مولّد",
        },
      ],
    });

    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();

    // Two approved questions is below the floor of three: falling through
    // entirely beats padding a drill out to length with whatever exists.
    await expect(page.getByText("A generated question ___.")).toBeVisible();
    expect(backend.callsTo("grammar-drill")).toHaveLength(1);
  });

  test("asks for the learner's dialect and difficulty when generating", async ({
    page,
    db,
    backend,
  }) => {
    seedApproved(db, 0);
    backend.stubFunction("grammar-drill", {
      questions: [
        {
          question: "Thin question ___.",
          question_ar: "سؤال",
          grammar_point: "Present tense",
          choices: [{ text: "goes", text_ar: "صح" }],
          correct_index: 0,
          explanation_ar: "",
        },
      ],
    });

    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Negation") }).click();
    await expect(page.getByText("Thin question ___.")).toBeVisible();

    expect(backend.lastCallTo("grammar-drill")?.body).toMatchObject({
      category: "negation",
      dialect: "Gulf",
    });
  });

  test("returns to the categories when nothing can be generated", async ({
    page,
    db,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedApproved(db, 0);
    backend.stubFunctionFailure("grammar-drill");

    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Negation") }).click();

    // Not a dead screen: the category is cleared so the learner is back
    // somewhere they can act, rather than looking at an empty drill.
    await expect(page.getByRole("button", { name: new RegExp("Verb Tenses") })).toBeVisible();
    await expect(page.getByText(/سؤال 1 من/)).toHaveCount(0);

    // The toast title is `e.message || "Failed to generate drill"`, and a
    // failed `functions.invoke` supplies a message — so the learner is shown
    // supabase-js's wording ("non-2xx status code") rather than the app's.
    // Pinned as-is: the fallback string is only reachable for an error with no
    // message at all.
    await expect(page.getByText(/non-2xx status code/i)).toBeVisible();
  });
});

test.describe("answering", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedApproved(db, 5);
  });

  test("counts a right answer", async ({ page }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 5")).toBeVisible();

    await page.getByRole("button", { name: /goes/ }).click();

    await expect(page.getByText("1 صحيحة")).toBeVisible();
  });

  test("leaves the score alone on a wrong answer", async ({ page }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 5")).toBeVisible();

    await page.getByRole("button", { name: /go \d/ }).click();

    await expect(page.getByText("0 صحيحة")).toBeVisible();
  });

  test("shows the explanation once an answer is locked in", async ({ page }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 5")).toBeVisible();

    await page.getByRole("button", { name: /go \d/ }).click();

    // A drill that only marks you wrong teaches nothing; the explanation is
    // the part that does the work.
    await expect(page.getByText(/لأن السبب/)).toBeVisible();
  });

  test("ignores a second answer to the same question", async ({ page }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 5")).toBeVisible();

    await page.getByRole("button", { name: /go \d/ }).click();

    // Every choice is disabled the moment one is taken. Otherwise the
    // explanation the page has just shown is a free retry, and the score means
    // nothing.
    await expect(page.getByRole("button", { name: /goes/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /go \d/ })).toBeDisabled();
    await expect(page.getByText("0 صحيحة")).toBeVisible();
  });

  test("keeps the Arabic support out of the way until asked for", async ({ page }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 5")).toBeVisible();

    await expect(page.getByText(/^اختر الشكل الصحيح/)).toHaveCount(0);
    await page.getByRole("button", { name: "ع" }).click();
    await expect(page.getByText(/^اختر الشكل الصحيح/)).toBeVisible();
  });
});

test.describe("finishing a round", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedApproved(db, 3);
  });

  test("scores the round as a percentage", async ({ page }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 3")).toBeVisible();

    await answerCorrectly(page);
    await answerCorrectly(page);
    await answerWrongly(page);

    await expect(page.getByText("أنهيت التمرين!")).toBeVisible();
    await expect(page.getByText("67%")).toBeVisible();
    await expect(page.getByText("2 / 3 صحيحة")).toBeVisible();
  });

  test("sends the round's hits and misses in order", async ({ page, backend }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 3")).toBeVisible();

    await answerWrongly(page);
    await answerCorrectly(page);
    await answerCorrectly(page);
    await expect(page.getByText("أنهيت التمرين!")).toBeVisible();

    // The order is the point: two right after a miss is a different signal
    // from a miss after two right, and the ladder is meant to tell them apart.
    await expect
      .poll(() => backend.lastCallTo("record-grammar-outcome")?.body)
      .toMatchObject({
        category: "verb-conjugation",
        dialect: "Gulf",
        outcomes: [false, true, true],
      });
  });

  test("submits the round exactly once", async ({ page, backend }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 3")).toBeVisible();

    await answerCorrectly(page);
    await answerCorrectly(page);
    await answerCorrectly(page);
    await expect(page.getByText("أنهيت التمرين!")).toBeVisible();

    // The results screen can re-render for reasons that have nothing to do
    // with the learner; a second submit would inflate the ladder.
    await expect.poll(() => backend.callsTo("record-grammar-outcome").length).toBe(1);
  });

  test("carries on when the ladder cannot be updated", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Couldn't record grammar mastery/]);
    backend.stubFunctionFailure("record-grammar-outcome");

    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 3")).toBeVisible();

    await answerCorrectly(page);
    await answerCorrectly(page);
    await answerCorrectly(page);

    // The learner did the work; losing the bookkeeping should not lose them
    // the result screen too.
    await expect(page.getByText("أنهيت التمرين!")).toBeVisible();
    await expect(page.getByText("100%")).toBeVisible();
  });

  test("starts a clean round from New Drill", async ({ page }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 3")).toBeVisible();
    await answerCorrectly(page);
    await answerCorrectly(page);
    await answerCorrectly(page);
    await expect(page.getByText("أنهيت التمرين!")).toBeVisible();

    await page.getByRole("button", { name: "تمرين جديد" }).click();

    await expect(page.getByRole("button", { name: new RegExp("Verb Tenses") })).toBeVisible();
    await expect(page.getByText("أنهيت التمرين!")).toHaveCount(0);
  });
});

test.describe("a drill interrupted", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedApproved(db, 3);
  });

  test("resumes where the learner left off", async ({ page }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 3")).toBeVisible();
    await answerCorrectly(page);
    await expect(page.getByText("سؤال 2 من 3")).toBeVisible();

    await page.reload();

    // Drills are generated per round, so losing one to a reload means losing
    // the questions themselves, not just the position.
    await expect(page.getByText("سؤال 2 من 3")).toBeVisible();
    await expect(page.getByText("1 صحيحة")).toBeVisible();
  });

  test("does not resurrect a drill that already finished", async ({ page, backend }) => {
    await page.goto("/grammar");
    await page.getByRole("button", { name: new RegExp("Verb Tenses") }).click();
    await expect(page.getByText("سؤال 1 من 3")).toBeVisible();
    await answerCorrectly(page);
    await answerCorrectly(page);
    await answerCorrectly(page);
    await expect(page.getByText("أنهيت التمرين!")).toBeVisible();
    await expect.poll(() => backend.callsTo("record-grammar-outcome").length).toBe(1);

    await page.reload();

    // The saved session carried questions, index, score and outcomes but not
    // `showResult`, and nothing cleared it when a drill ended — so reloading
    // dropped the learner back onto the final question with the score already
    // banked. Answering it again re-finished the round, and `submittedRef`
    // only guards within one mount, so a three-question drill sent four
    // results to the mastery ladder. A finished drill has nothing to resume,
    // so its entry is cleared rather than written.
    await expect(page.getByText("سؤال 3 من 3")).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp("Verb Tenses") })).toBeVisible();

    await expect.poll(() => backend.callsTo("record-grammar-outcome").length).toBe(1);
  });
});
