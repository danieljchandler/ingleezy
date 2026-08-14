import { expect, test, type Page } from "./support/fixtures";
import { aProfile, TEST_USER_ID } from "../src/test/support/factories";

/**
 * Onboarding and the placement quiz — the first five minutes of the product.
 *
 * Everything downstream is conditioned on what these two screens write. The
 * dialect decides which curriculum, which Listen catalogue and which CSS theme
 * the learner gets; the placement level decides the difficulty of generated
 * content; `onboarding_completed` is what stops the app bouncing them back here
 * on every sign-in. A write that silently goes to the wrong column leaves a
 * learner permanently mis-levelled with nothing on screen to explain why, so
 * these specs assert the persisted row rather than the confirmation toast.
 */

const STEP_HEADINGS = {
  welcome: /مرحباً بك في إنجليزي/,
  dialect: /ما لهجتك؟/,
  level: /ما مستواك في الإنجليزية؟/,
  purpose: /لماذا تريد تعلم الإنجليزية؟/,
  goal: /حدد هدفك الأسبوعي/,
} as const;

/** Walk from the welcome screen to a named step, taking the defaults. */
async function advanceTo(page: Page, target: keyof typeof STEP_HEADINGS) {
  const order = ["welcome", "dialect", "level", "purpose", "goal"] as const;
  await page.getByRole("button", { name: "لنبدأ" }).click();

  for (const step of order.slice(1, order.indexOf(target) + 1)) {
    await expect(page.getByRole("heading", { name: STEP_HEADINGS[step] })).toBeVisible();
    if (step === target) return;
    await page.getByRole("button", { name: "متابعة", exact: true }).click();
  }
}

test.describe("onboarding", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    // A learner who has not finished onboarding. The row must exist — the
    // finish step is an UPDATE, and an update matching nothing succeeds
    // silently, which is exactly the failure this suite is here to catch.
    db.seed("profiles", [aProfile({ onboarding_completed: false })]);
  });

  test("opens on the welcome step and counts the steps honestly", async ({ page }) => {
    await page.goto("/onboarding");

    await expect(page.getByRole("heading", { name: STEP_HEADINGS.welcome })).toBeVisible();
    await expect(page.getByText("الخطوة 1 من 5")).toBeVisible();
  });

  test("walks forward through all five steps", async ({ page }) => {
    await page.goto("/onboarding");

    await advanceTo(page, "goal");
    await expect(page.getByText("الخطوة 5 من 5")).toBeVisible();
  });

  test("goes back without losing the choice already made", async ({ page }) => {
    await page.goto("/onboarding");
    await advanceTo(page, "dialect");

    await page.getByRole("button", { name: /مصري/ }).click();
    await page.getByRole("button", { name: "متابعة", exact: true }).click();
    await expect(page.getByRole("heading", { name: STEP_HEADINGS.level })).toBeVisible();

    // The back control is icon-only, so it is addressed by position rather than
    // by name. It is the first button in the footer pair.
    await page.getByRole("button").filter({ hasText: /^$/ }).last().click();

    await expect(page.getByRole("heading", { name: STEP_HEADINGS.dialect })).toBeVisible();
    // Still selected — a wizard that resets on back makes the whole flow
    // impossible to correct.
    await expect(page.getByRole("button", { name: /مصري/ })).toHaveClass(
      /border-primary/,
    );
  });

  test("offers exactly the three dialects the app supports", async ({ page }) => {
    await page.goto("/onboarding");
    await advanceTo(page, "dialect");

    // DialectContext recognises Gulf, Egyptian and Yemeni and silently falls
    // back to Gulf for anything else — an extra option here would be a picker
    // that appears to work and does nothing.
    await expect(page.getByRole("button", { name: /خليجي/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /مصري/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /يمني/ })).toBeVisible();
  });

  test("saves every answer to the profile and lands on the home page", async ({ page, db }) => {
    await page.goto("/onboarding");

    await advanceTo(page, "dialect");
    await page.getByRole("button", { name: /يمني/ }).click();
    await page.getByRole("button", { name: "متابعة", exact: true }).click();

    await page.getByRole("button", { name: /متوسط/ }).first().click();
    await page.getByRole("button", { name: "متابعة", exact: true }).click();

    await page.getByRole("button", { name: /العائلة والشريك/ }).click();
    await page.getByRole("button", { name: "متابعة", exact: true }).click();

    await page.getByRole("button", { name: /جاد/ }).click();
    await page.getByRole("button", { name: /ابدأ التعلم/ }).click();

    await expect(page).toHaveURL(/\/$/);

    const profile = db.rows("profiles")[0];
    expect(profile.onboarding_completed).toBe(true);
    expect(profile.preferred_dialect).toBe("Yemeni");
    expect(profile.proficiency_level).toBe("intermediate");
    expect(profile.weekly_goal).toBe("serious");
    // Stored as the human label, not the id — the server-side learner profile
    // feeds it straight into generation prompts.
    expect(profile.learning_reason).toBe("Family & partner");
  });

  test("turns the goal into concrete weekly targets", async ({ page, db }) => {
    await page.goto("/onboarding");
    await advanceTo(page, "goal");

    await page.getByRole("button", { name: /خفيف/ }).click();
    await page.getByRole("button", { name: /ابدأ التعلم/ }).click();
    await expect(page).toHaveURL(/\/$/);

    // The labels are prose; these numbers are what the goal ring on the home
    // page actually measures against.
    const goal = db.rows("weekly_goals")[0];
    expect(goal).toBeDefined();
    expect(goal.user_id).toBe(TEST_USER_ID);
    expect(Number(goal.target_reviews)).toBe(20);
    expect(Number(goal.target_xp)).toBe(100);
  });

  test("dates the weekly goal from the start of this week", async ({ page, db }) => {
    await page.goto("/onboarding");
    await advanceTo(page, "goal");
    await page.getByRole("button", { name: /ابدأ التعلم/ }).click();
    await expect(page).toHaveURL(/\/$/);

    // Upserted on (user_id, week_start_date), so a wrong date silently creates a
    // second goal row every time onboarding is repeated.
    const expected = new Date();
    expected.setDate(expected.getDate() - expected.getDay());
    expect(db.rows("weekly_goals")[0].week_start_date).toBe(
      expected.toISOString().split("T")[0],
    );
  });

  test("records the topics picked, by id rather than by label", async ({ page, db }) => {
    await page.goto("/onboarding");
    await advanceTo(page, "purpose");

    await page.getByRole("button", { name: /الطعام والسفر/ }).click();
    await page.getByRole("button", { name: /الرياضة/ }).click();

    await page.getByRole("button", { name: "متابعة", exact: true }).click();
    await page.getByRole("button", { name: /ابدأ التعلم/ }).click();
    await expect(page).toHaveURL(/\/$/);

    // The ids, not the display labels — the Listen catalogue and the story
    // generators both look topics up by id, so labels here would match nothing.
    expect(db.rows("profiles")[0].interests).toEqual(["food", "sports"]);
  });

  test("lets a topic be unpicked", async ({ page, db }) => {
    await page.goto("/onboarding");
    await advanceTo(page, "purpose");

    const sports = page.getByRole("button", { name: /الرياضة/ });
    await sports.click();
    await expect(sports).toHaveAttribute("aria-pressed", "true");
    await sports.click();
    await expect(sports).toHaveAttribute("aria-pressed", "false");

    await page.getByRole("button", { name: "متابعة", exact: true }).click();
    await page.getByRole("button", { name: /ابدأ التعلم/ }).click();
    await expect(page).toHaveURL(/\/$/);

    expect(db.rows("profiles")[0].interests).toEqual([]);
  });

  test("purpose and topics are both optional", async ({ page, db }) => {
    await page.goto("/onboarding");
    await advanceTo(page, "goal");
    await page.getByRole("button", { name: /ابدأ التعلم/ }).click();

    await expect(page).toHaveURL(/\/$/);
    expect(db.rows("profiles")[0].learning_reason).toBeNull();
    expect(db.rows("profiles")[0].interests).toEqual([]);
  });

  test("keeps the learner on the form when the save fails", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);

    await page.goto("/onboarding");
    await advanceTo(page, "goal");

    db.failWrites("profiles", 500);
    await page.getByRole("button", { name: /ابدأ التعلم/ }).click();

    // Navigating away on a failed save would strand the learner with an
    // unfinished profile and no way back to the form.
    await expect(page.getByText(/تعذّر حفظ التفضيلات/)).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/onboarding");

    await expect(page).toHaveURL(/\/auth$/);
  });
});

test.describe("the placement quiz", () => {
  /** One generated question; `correct` picks which choice is right. */
  const question = (index: number, correct = 0) => ({
    question_english: `question ${index}`,
    question_arabic: `سؤال ${index}`,
    skill_type: "vocabulary",
    difficulty: "B1",
    choices: [
      { text: `right ${index}`, text_arabic: `صح ${index}` },
      { text: `wrong ${index}`, text_arabic: `خطأ ${index}` },
    ],
    correct_index: correct,
  });

  /**
   * The quiz generates in batches of five and scores through the same function,
   * discriminated by `action`.
   */
  function stubQuiz(
    backend: import("../src/test/support/server/handler").SupabaseBackend,
    score: Record<string, unknown> = {
      cefr_level: "B2",
      confidence: 82,
      strengths: ["listening_comprehension"],
      weaknesses: ["verb_conjugation"],
    },
  ) {
    let generated = 0;
    backend.stubFunction("placement-quiz", ({ body }) => {
      const action = (body as { action?: string })?.action;
      if (action === "score") return score;
      const batch = Array.from({ length: 5 }, () => question(++generated));
      return { questions: batch };
    });
  }

  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
  });

  test("explains itself before asking anything", async ({ page, backend }) => {
    stubQuiz(backend);
    await page.goto("/placement");

    await expect(page.getByRole("heading", { name: /اختبار تحديد المستوى/ })).toBeVisible();
    await expect(page.getByText("20", { exact: true })).toBeVisible();
    // Nothing generated until the learner opts in — the quiz costs an AI call.
    expect(backend.callsTo("placement-quiz")).toHaveLength(0);
  });

  test("asks the generator for questions in the learner's dialect", async ({ page, backend }) => {
    stubQuiz(backend);
    await page.goto("/placement");
    await page.getByRole("button", { name: "ابدأ الاختبار" }).click();

    await expect(page.getByText("question 1", { exact: true })).toBeVisible();

    // The dialect still travels: it names the language of the Arabic support
    // and the placement_history bucket, not the language being tested.
    const body = backend.lastCallTo("placement-quiz")?.body as Record<string, unknown>;
    expect(body.action).toBe("generate");
    expect(body.dialect).toBe("Gulf");
    expect(body.question_number).toBe(0);
  });

  test("counts questions across batches, not within one", async ({ page, backend }) => {
    stubQuiz(backend);
    await page.goto("/placement");
    await page.getByRole("button", { name: "ابدأ الاختبار" }).click();

    await expect(page.getByText("سؤال 1 من 20")).toBeVisible();
    await page.getByRole("button", { name: /right 1/ }).click();
    await expect(page.getByText("سؤال 2 من 20")).toBeVisible();
  });

  test("marks the answer right or wrong before moving on", async ({ page, backend }) => {
    stubQuiz(backend);
    await page.goto("/placement");
    await page.getByRole("button", { name: "ابدأ الاختبار" }).click();

    await page.getByRole("button", { name: /wrong 1/ }).click();

    // The wrong choice is marked, and so is the right one — feedback that only
    // said "wrong" would teach nothing.
    await expect(page.getByRole("button", { name: /wrong 1/ })).toHaveClass(/border-destructive/);
    await expect(page.getByRole("button", { name: /right 1/ })).toHaveClass(/border-green-500/);
  });

  test("ignores a second click on the same question", async ({ page, backend }) => {
    stubQuiz(backend);
    await page.goto("/placement");
    await page.getByRole("button", { name: "ابدأ الاختبار" }).click();

    await page.getByRole("button", { name: /right 1/ }).click();
    // Both choices are disabled during feedback, so a double-tap cannot record
    // two answers for one question and desynchronise the 20-question count.
    await expect(page.getByRole("button", { name: /wrong 1/ })).toBeDisabled();
  });

  test("shows the Arabic support only when asked", async ({ page, backend }) => {
    stubQuiz(backend);
    await page.goto("/placement");
    await page.getByRole("button", { name: "ابدأ الاختبار" }).click();

    // The English is the test; the dialect support is there for a learner who
    // cannot yet parse the question, not shown by default.
    await expect(page.getByText("سؤال 1", { exact: true })).toHaveCount(0);
    await page.getByRole("switch").click();
    await expect(page.getByText("سؤال 1", { exact: true })).toBeVisible();
  });

  test("fetches a fresh batch every fifth question", async ({ page, backend }) => {
    stubQuiz(backend);
    await page.goto("/placement");
    await page.getByRole("button", { name: "ابدأ الاختبار" }).click();

    for (let index = 1; index <= 5; index++) {
      await page.getByRole("button", { name: new RegExp(`right ${index}$`) }).click();
    }

    // Question six comes from a second generate call, and that call carries the
    // answer history the adaptive difficulty is based on.
    await expect(page.getByText("question 6", { exact: true })).toBeVisible();
    const calls = backend.callsTo("placement-quiz");
    expect(calls).toHaveLength(2);
    const body = calls[1].body as { question_number: number; history: unknown[] };
    expect(body.question_number).toBe(5);
    expect(body.history).toHaveLength(5);
  });

  test("stays on the intro when the generator fails", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Failed to fetch questions/]);
    backend.stubFunctionFailure("placement-quiz");

    await page.goto("/placement");
    await page.getByRole("button", { name: "ابدأ الاختبار" }).click();

    await expect(page.getByText(/تعذّر تحميل الأسئلة/)).toBeVisible();
    await expect(page.getByRole("button", { name: "ابدأ الاختبار" })).toBeVisible();
  });

  test.describe("finishing", () => {
    // Twenty questions with a 1.5s feedback pause each; the assertions after it
    // are the point, so give the walk room rather than shortening the pause.
    test.setTimeout(120_000);

    /** Answer every question correctly until the results screen appears. */
    async function completeQuiz(page: Page) {
      await page.getByRole("button", { name: "ابدأ الاختبار" }).click();
      for (let index = 1; index <= 20; index++) {
        await page.getByRole("button", { name: new RegExp(`right ${index}$`) }).click();
      }
      await expect(page.getByRole("heading", { name: "B2" })).toBeVisible({ timeout: 20_000 });
    }

    test("scores the whole history and reports the level", async ({ page, backend }) => {
      stubQuiz(backend);
      await page.goto("/placement");
      await completeQuiz(page);

      await expect(page.getByText(/فوق المتوسط/)).toBeVisible();
      await expect(page.getByText(/listening comprehension/)).toBeVisible();
      await expect(page.getByText(/verb conjugation/)).toBeVisible();

      const scoring = backend.callsTo("placement-quiz").at(-1)?.body as {
        action: string;
        history: unknown[];
      };
      expect(scoring.action).toBe("score");
      expect(scoring.history).toHaveLength(20);
    });

    test("writes the level against the dialect it was taken in", async ({ page, backend, db }) => {
      stubQuiz(backend);
      await page.goto("/placement");
      await completeQuiz(page);

      await page.getByRole("button", { name: /ابدأ التعلم/ }).click();
      await expect(page).toHaveURL(/\/$/);

      const profile = db.rows("profiles")[0];
      // Per-dialect, because a learner fluent in Gulf is not thereby B2 in
      // Egyptian. The legacy unsuffixed columns are kept in step deliberately.
      expect(profile.placement_level_gulf).toBe("B2");
      expect(profile.placement_taken_at_gulf).toBeTruthy();
      expect(profile.placement_level).toBe("B2");
      expect(profile.proficiency_level).toBe("advanced");
    });

    test("retaking clears the previous result", async ({ page, backend }) => {
      stubQuiz(backend);
      await page.goto("/placement");
      await completeQuiz(page);

      await page.getByRole("button", { name: "أعد الاختبار" }).click();

      await expect(page.getByRole("button", { name: "ابدأ الاختبار" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "B2" })).toHaveCount(0);
    });

    test("falls back to a client-side level when scoring fails", async ({
      page,
      backend,
      expectConsoleErrors,
    }) => {
      expectConsoleErrors([/.*/]);

      let generated = 0;
      backend.stubFunction("placement-quiz", ({ body }) => {
        if ((body as { action?: string })?.action === "score") {
          return { status: 500, body: { error: "scoring_unavailable" } };
        }
        return { questions: Array.from({ length: 5 }, () => question(++generated)) };
      });

      await page.goto("/placement");
      await page.getByRole("button", { name: "ابدأ الاختبار" }).click();
      for (let index = 1; index <= 20; index++) {
        await page.getByRole("button", { name: new RegExp(`right ${index}$`) }).click();
      }

      // Twenty questions answered and no level to show for it would be the worst
      // possible outcome, so the page guesses B1 rather than dropping the run.
      await expect(page.getByRole("heading", { name: "B1" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/تعذّر حساب النتيجة/)).toBeVisible();
    });
  });
});
