import { expect, test, type Page } from "./support/fixtures";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * Souq News — today's regional headlines retold in easy English.
 *
 * Entirely generated: there is no table behind it, just an edge function per
 * dialect (which picks the learner's region), so the failure modes are
 * different from the rest of the app. There is nothing to fall back on, so an
 * error has to say so rather than render as "no news today" — a learner told
 * the world was quiet has no reason to press Try Again.
 *
 * It is also one of the daily-queue tasks, and the completion signal is
 * unusual: opening the Arabic summary marks it done. That is the only
 * interaction the page can be sure means the learner engaged with the article,
 * so it is worth pinning against the alternative of marking it on load.
 */

const TODAY_KEY = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `today.completed.${now.getFullYear()}-${month}-${day}`;
};

const completedToday = async (page: Page) =>
  JSON.parse(
    (await page.evaluate((key) => window.localStorage.getItem(key), TODAY_KEY())) ?? "[]",
  ) as string[];

const anArticle = (over: Record<string, unknown> = {}) => ({
  title_english: "The market today",
  body_english: "Vegetable prices fell in the market today.",
  title_arabic: "السوق اليوم",
  summary_arabic: "نزلت أسعار الخضار في السوق هذا الصباح.",
  source_url: "https://news.example.com/article",
  published_at: new Date().toISOString(),
  sentences: [
    {
      english: "Vegetable prices fell in the market today.",
      arabic: "أسعار الخضار نزلت اليوم في السوق.",
      literal: "خضار أسعار نزلت في السوق اليوم",
    },
  ],
  vocabulary: [{ english: "prices", arabic: "أسعار" }],
  ...over,
});

function stubNews(backend: SupabaseBackend, articles: unknown[] = [anArticle()]) {
  backend.stubFunction("souq-news", { articles });
}

test.describe("reading the news", () => {
  test.beforeEach(async ({ signInAs, backend }) => {
    await signInAs("free");
    stubNews(backend);
  });

  test("asks for the news in the learner's dialect", async ({ page, backend }) => {
    await page.goto("/souq-news");

    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();
    // The dialect picks both the region searched and the language of the
    // scaffold; a request without one would gloss a Yemeni's news in the
    // wrong Arabic.
    expect(backend.lastCallTo("souq-news")?.body).toMatchObject({ dialect: "Gulf" });
  });

  test("reveals a sentence's Arabic only when asked", async ({ page }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();

    // The scaffold is behind a tap so the eye cannot cheat while reading.
    await expect(page.getByText("أسعار الخضار نزلت اليوم في السوق.")).not.toBeVisible();
    await page.getByRole("button", { name: "ورّني الترجمة" }).click();

    await expect(page.getByText("أسعار الخضار نزلت اليوم في السوق.").first()).toBeVisible();
  });

  test("keeps the Arabic summary out of the way until asked", async ({ page }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();

    // The per-sentence scaffold has its own reveal inside SentenceReader; this
    // is the article-level headline and summary, which start collapsed.
    await expect(page.getByText("السوق اليوم", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "ورّني العربي" }).click();

    await expect(page.getByText("السوق اليوم", { exact: true })).toBeVisible();
  });

  test("hides the summary again", async ({ page }) => {
    await page.goto("/souq-news");
    await page.getByRole("button", { name: "ورّني العربي" }).click();
    await expect(page.getByText("السوق اليوم", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "أخفِ العربي" }).click();
    await expect(page.getByText("السوق اليوم", { exact: true })).toHaveCount(0);
  });

  test("shows the vocabulary the retelling introduced", async ({ page }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();

    // The generator names 2-3 words worth learning; dropping them would waste
    // the one part of the response written specifically for the deck.
    await expect(page.getByText("أسعار", { exact: true })).toBeVisible();
  });

  test("links out to the source", async ({ page }) => {
    await page.goto("/souq-news");

    // These are real news stories retold; the link is what lets a learner check
    // the retelling against the original.
    await expect(page.getByRole("link", { name: /source/i })).toHaveAttribute(
      "href",
      "https://news.example.com/article",
    );
  });

  test("omits the source link when there is nothing to link to", async ({ page, backend }) => {
    stubNews(backend, [anArticle({ source_url: null })]);
    await page.goto("/souq-news");

    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();
    await expect(page.getByRole("link", { name: /source/i })).toHaveCount(0);
  });

  test("marks the daily task done when the Arabic is opened", async ({ page }) => {
    await page.goto("/souq-news");
    expect(await completedToday(page)).not.toContain("souq");

    await page.getByRole("button", { name: "ورّني العربي" }).click();

    // Reaching for the summary is the only signal the page has that the
    // learner actually engaged with the article. Marking it on load would let
    // the queue clear itself.
    await expect
      .poll(async () => await completedToday(page))
      .toContain("souq");
  });

  test("refetches on request", async ({ page, backend }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();

    await page.getByRole("button").filter({ hasText: /^$/ }).last().click();

    await expect.poll(() => backend.callsTo("souq-news").length).toBeGreaterThan(1);
  });
});

test.describe("when there is no news", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("says so for an empty day", async ({ page, backend }) => {
    stubNews(backend, []);
    await page.goto("/souq-news");

    await expect(page.getByText(/ما فيه أخبار اليوم/)).toBeVisible();
  });

  test("offers a retry rather than claiming the day was quiet", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("souq-news");

    await page.goto("/souq-news");

    // The distinction that matters: nothing generated is not the same as
    // nothing happening in the world, and only one of them is worth retrying.
    await expect(page.getByText(/تعذّر تحميل الأخبار/)).toBeVisible();
    await expect(page.getByRole("button", { name: "جرّب مرة ثانية" })).toBeVisible();
    await expect(page.getByText(/no news found/i)).toHaveCount(0);
  });

  test("retries when asked", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("souq-news");

    await page.goto("/souq-news");
    await expect(page.getByRole("button", { name: "جرّب مرة ثانية" })).toBeVisible();

    stubNews(backend);
    await page.getByRole("button", { name: "جرّب مرة ثانية" }).click();

    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();
  });
});

test.describe("the comprehension quiz", () => {
  const QUESTIONS = {
    questions: [
      {
        question_english: "What happened to prices?",
        question_arabic: "شنو صار للأسعار؟",
        choices: [
          { english: "they fell", arabic: "نزلت", correct: true },
          { english: "they rose", arabic: "ارتفعت", correct: false },
        ],
        explanation: "المقال يقول إن الأسعار نزلت.",
      },
      {
        question_english: "Where did this happen?",
        question_arabic: "وين صار هذا؟",
        choices: [
          { english: "in the market", arabic: "في السوق", correct: true },
          { english: "at home", arabic: "في البيت", correct: false },
        ],
        explanation: "في السوق.",
      },
    ],
  };

  test.beforeEach(async ({ signInAs, backend }) => {
    await signInAs("free");
    stubNews(backend);
    backend.stubFunction("souq-news-quiz", QUESTIONS);
  });

  test("generates questions from the article that was read", async ({ page, backend }) => {
    await page.goto("/souq-news");
    await page.getByRole("button", { name: /test comprehension/i }).click();

    await expect(page.getByText("Question 1/2")).toBeVisible();
    // Questions have to come from this article, not from the topic in general,
    // or the quiz tests reading comprehension of something else.
    expect(backend.lastCallTo("souq-news-quiz")?.body).toMatchObject({
      dialect: "Gulf",
      title_english: "The market today",
      body_english: "Vegetable prices fell in the market today.",
    });
  });

  test("marks the answer and explains it in the learner's dialect", async ({ page }) => {
    await page.goto("/souq-news");
    await page.getByRole("button", { name: /test comprehension/i }).click();
    await expect(page.getByText("Question 1/2")).toBeVisible();

    await page.getByRole("button", { name: /they rose/ }).click();

    // Both are marked: knowing you were wrong without seeing the right answer
    // teaches nothing — and the why arrives in the learner's own Arabic.
    await expect(page.getByText("المقال يقول إن الأسعار نزلت.")).toBeVisible();
  });

  test("counts a correct answer", async ({ page }) => {
    await page.goto("/souq-news");
    await page.getByRole("button", { name: /test comprehension/i }).click();
    await page.getByRole("button", { name: /they fell/ }).click();

    await expect(page.getByText("1 correct")).toBeVisible();
  });

  test("refuses a second answer to the same question", async ({ page }) => {
    await page.goto("/souq-news");
    await page.getByRole("button", { name: /test comprehension/i }).click();
    await page.getByRole("button", { name: /they fell/ }).click();

    // A second click would score the same question twice and put the total
    // above the number of questions.
    await expect(page.getByRole("button", { name: /they rose/ })).toBeDisabled();
    await expect(page.getByText("1 correct")).toBeVisible();
  });

  test("scores the whole quiz at the end", async ({ page }) => {
    await page.goto("/souq-news");
    await page.getByRole("button", { name: /test comprehension/i }).click();

    await page.getByRole("button", { name: /they fell/ }).click();
    await page.getByRole("button", { name: /next question/i }).click();
    await page.getByRole("button", { name: /in the market/ }).click();
    await page.getByRole("button", { name: /see results/i }).click();

    await expect(page.getByText("2/2")).toBeVisible();
    await expect(page.getByText(/perfect/i)).toBeVisible();
  });

  test("closes back to the article", async ({ page }) => {
    await page.goto("/souq-news");
    await page.getByRole("button", { name: /test comprehension/i }).click();
    await page.getByRole("button", { name: /they fell/ }).click();
    await page.getByRole("button", { name: /next question/i }).click();
    await page.getByRole("button", { name: /in the market/ }).click();
    await page.getByRole("button", { name: /see results/i }).click();
    await expect(page.getByText("2/2")).toBeVisible();

    await page.getByRole("button", { name: /أغلق الاختبار/ }).click();

    await expect(page.getByRole("button", { name: /test comprehension/i })).toBeVisible();
  });

  test("leaves the article readable when the quiz cannot be generated", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Quiz error/]);
    backend.stubFunctionFailure("souq-news-quiz");

    await page.goto("/souq-news");
    await page.getByRole("button", { name: /test comprehension/i }).click();

    // The quiz is an extra; losing it must not take the article with it.
    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();
    await expect(page.getByRole("button", { name: /test comprehension/i })).toBeVisible();
  });
});

test.describe("saving a word met in an article", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    stubNews(backend);
    backend.stubFunction("translate-phrase", { translation: "أسعار" });
    db.seed("user_vocabulary", []);
  });

  test("taps a word, sees its dialect meaning, and saves it", async ({ page, db }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();

    // Every word of the English is its own tap target; the popover carries the
    // dialect gloss and the save.
    await page.getByRole("button", { name: "prices", exact: true }).click();
    await expect(page.getByText("أسعار").last()).toBeVisible();
    await page.getByRole("button", { name: "احفظ في كلماتي" }).click();

    await expect.poll(() => db.rows("user_vocabulary").length, { timeout: 10_000 }).toBe(1);
    const saved = db.rows("user_vocabulary")[0];
    expect(saved.source).toBe("souq-news");
    expect(saved.word_english).toBe("prices");
    expect(saved.word_arabic).toBe("أسعار");
  });

  test("carries the sentence the word was met in", async ({ page, db }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "The market today" })).toBeVisible();

    await page.getByRole("button", { name: "prices", exact: true }).click();
    await page.getByRole("button", { name: "احفظ في كلماتي" }).click();

    // The sentence is most of the value of saving from a reading surface: the
    // card comes back with the context the word was actually met in.
    await expect.poll(() => db.rows("user_vocabulary").length, { timeout: 10_000 }).toBe(1);
    expect(db.rows("user_vocabulary")[0].sentence_english).toBe(
      "Vegetable prices fell in the market today.",
    );
  });
});
