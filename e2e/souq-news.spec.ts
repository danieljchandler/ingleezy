import { expect, test, type Page } from "./support/fixtures";
import { aUserVocabulary, vocabId } from "../src/test/support/factories";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * Souq News — today's headlines retold in dialect.
 *
 * Entirely generated: there is no table behind it, just an edge function per
 * dialect, which makes the failure modes different from the rest of the app.
 * There is nothing to fall back on, so an error has to say so rather than
 * render as "no news today" — a learner told the world was quiet has no reason
 * to press Try Again.
 *
 * It is also one of the daily-queue tasks, and the completion signal is
 * unusual: opening the English marks it done. That is the only interaction the
 * page can be sure means the article was read, so it is worth pinning against
 * the alternative of marking it on load.
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
  title_dialect: "السوق اليوم",
  body_dialect: "أسعار الخضار نزلت اليوم في السوق.",
  title_english: "The market today",
  summary_english: "Vegetable prices fell today.",
  source_url: "https://news.example.com/article",
  published_at: new Date().toISOString(),
  sentences: [
    {
      arabic: "أسعار الخضار نزلت اليوم في السوق.",
      english: "Vegetable prices fell in the market today.",
      literal: "prices the-vegetables fell today in the-market",
    },
  ],
  vocabulary: [{ word_arabic: "أسعار", word_english: "prices" }],
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

    await expect(page.getByRole("heading", { name: "السوق اليوم" })).toBeVisible();
    // The whole point of the feature is dialect; a request without one would
    // return MSA and defeat it.
    expect(backend.lastCallTo("souq-news")?.body).toMatchObject({ dialect: "Gulf" });
  });

  test("keeps the article summary out of the way until asked", async ({ page }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "السوق اليوم" })).toBeVisible();

    // The per-sentence gloss has its own reveal inside SentenceReader; this
    // is the article-level headline and summary, which start collapsed.
    await expect(page.getByText("Vegetable prices fell today.")).toHaveCount(0);
    await page.getByRole("button", { name: /show english/i }).click();

    await expect(page.getByText("The market today").first()).toBeVisible();
    await expect(page.getByText("Vegetable prices fell today.")).toBeVisible();
  });

  test("hides the summary again", async ({ page }) => {
    await page.goto("/souq-news");
    await page.getByRole("button", { name: /show english/i }).click();
    await expect(page.getByText("Vegetable prices fell today.")).toBeVisible();

    await page.getByRole("button", { name: /hide english/i }).click();
    await expect(page.getByText("Vegetable prices fell today.")).toHaveCount(0);
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

    await expect(page.getByRole("heading", { name: "السوق اليوم" })).toBeVisible();
    await expect(page.getByRole("link", { name: /source/i })).toHaveCount(0);
  });

  test("marks the daily task done when the English is opened", async ({ page }) => {
    await page.goto("/souq-news");
    expect(await completedToday(page)).not.toContain("souq");

    await page.getByRole("button", { name: /show english/i }).click();

    // Opening the translation is the only signal the page has that the article
    // was actually read. Marking it on load would let the queue clear itself.
    await expect
      .poll(async () => await completedToday(page))
      .toContain("souq");
  });

  test("refetches on request", async ({ page, backend }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "السوق اليوم" })).toBeVisible();

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

    await expect(page.getByText(/no news found for today/i)).toBeVisible();
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
    await expect(page.getByText(/failed to load news/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
    await expect(page.getByText(/no news found/i)).toHaveCount(0);
  });

  test("retries when asked", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("souq-news");

    await page.goto("/souq-news");
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();

    stubNews(backend);
    await page.getByRole("button", { name: /try again/i }).click();

    await expect(page.getByRole("heading", { name: "السوق اليوم" })).toBeVisible();
  });
});

test.describe("the comprehension quiz", () => {
  const QUESTIONS = {
    questions: [
      {
        question_arabic: "شنو صار للأسعار؟",
        question_english: "What happened to prices?",
        choices: [
          { arabic: "نزلت", english: "they fell", correct: true },
          { arabic: "ارتفعت", english: "they rose", correct: false },
        ],
        explanation: "The article says prices fell.",
      },
      {
        question_arabic: "وين صار هذا؟",
        question_english: "Where did this happen?",
        choices: [
          { arabic: "في السوق", english: "in the market", correct: true },
          { arabic: "في البيت", english: "at home", correct: false },
        ],
        explanation: "In the market.",
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
      title_dialect: "السوق اليوم",
    });
  });

  test("marks the answer and explains it", async ({ page }) => {
    await page.goto("/souq-news");
    await page.getByRole("button", { name: /test comprehension/i }).click();
    await expect(page.getByText("Question 1/2")).toBeVisible();

    await page.getByRole("button", { name: /they rose/ }).click();

    // Both are marked: knowing you were wrong without seeing the right answer
    // teaches nothing.
    await expect(page.getByText("The article says prices fell.")).toBeVisible();
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

    await page.getByRole("button", { name: /close quiz/i }).click();

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
    await expect(page.getByRole("heading", { name: "السوق اليوم" })).toBeVisible();
    await expect(page.getByRole("button", { name: /test comprehension/i })).toBeVisible();
  });
});

test.describe("marking words to save in bulk", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    stubNews(backend);
    db.seed("user_vocabulary", []);
  });

  test("saves every marked word in one go", async ({ page, db }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "السوق اليوم" })).toBeVisible();

    await page.getByRole("button", { name: /mark unknown|mark words/i }).click();
    await page.getByRole("button", { name: /Mark “أسعار” as unknown/ }).click();

    await expect(page.getByText(/1 word marked/)).toBeVisible();
    await page.getByRole("button", { name: /^save 1$/i }).click();

    // A bulk insert rather than one request per word: a learner reading an
    // article marks a dozen, and a dozen round-trips on a phone connection is
    // where a save gets half-finished.
    await expect.poll(() => db.rows("user_vocabulary").length, { timeout: 10_000 }).toBe(1);
    expect(db.rows("user_vocabulary")[0].source).toBe("souq-news");
  });

  test("counts words already saved rather than failing on them", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), word_arabic: "أسعار", word_english: "prices" }),
    ]);

    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "السوق اليوم" })).toBeVisible();

    await page.getByRole("button", { name: /mark unknown|mark words/i }).click();
    await page.getByRole("button", { name: /Mark “أسعار” as unknown/ }).click();
    await page.getByRole("button", { name: /^save 1$/i }).click();

    // Re-reading an article is normal, and a word already in the deck is not
    // an error — the bar reports the split rather than refusing the batch.
    await expect(page.getByText(/already in My Words/i)).toBeVisible();
  });

  test("cancels without saving anything", async ({ page, db }) => {
    await page.goto("/souq-news");
    await expect(page.getByRole("heading", { name: "السوق اليوم" })).toBeVisible();

    await page.getByRole("button", { name: /mark unknown|mark words/i }).click();
    await page.getByRole("button", { name: /Mark “أسعار” as unknown/ }).click();
    await expect(page.getByText(/1 word marked/)).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByText(/1 word marked/)).toHaveCount(0);
    expect(db.rows("user_vocabulary")).toHaveLength(0);
  });
});
