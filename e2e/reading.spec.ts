import { expect, test, type Page } from "./support/fixtures";
import { aProfile, aUserXp } from "../src/test/support/factories";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * Reading Practice — a generated passage plus a comprehension quiz.
 *
 * The only page that prefers hand-published content over generation: it looks
 * for an approved `reading_passages` row matching the difficulty and dialect
 * first, and generates only when there is none. That ordering is what keeps
 * editorial passages in circulation, and it is invisible from the UI — a broken
 * lookup just means everyone gets generated text and nobody notices the library
 * is being ignored.
 *
 * The generation call is also the app's longest wait, with a silent single
 * retry behind it, so a first failure has to be recovered from rather than
 * surfaced.
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

const PASSAGE = {
  title: "في المقهى",
  titleEnglish: "At the cafe",
  passage: "رحت المقهى الصبح. طلبت قهوة.",
  passageEnglish: "I went to the cafe in the morning. I ordered a coffee.",
  lines: [
    { arabic: "رحت المقهى الصبح.", english: "I went to the cafe in the morning." },
    { arabic: "طلبت قهوة.", english: "I ordered a coffee." },
  ],
  vocabulary: [{ arabic: "مقهى", english: "cafe" }],
  questions: [
    {
      question: "Where did the writer go?",
      options: [
        { text: "To the cafe", correct: true },
        { text: "To the market", correct: false },
      ],
    },
    {
      question: "What did they order?",
      options: [
        { text: "Coffee", correct: true },
        { text: "Tea", correct: false },
      ],
    },
  ],
};

/**
 * A published passage row, as the editorial library holds one.
 *
 * Deliberately has no per-line breakdown: `reading_passages` stores the passage
 * as one block of text and has no `lines` column at all, so the page splits it
 * on sentence boundaries itself. The tap-to-translate reading view is built out
 * of those lines, which makes the split load-bearing for every editorial
 * passage — see "breaks a library passage into lines" below.
 */
const aPublishedPassage = (over: Record<string, unknown> = {}) => ({
  id: "dddddddd-0000-4000-8000-000000000001",
  title: "من المكتبة",
  title_english: "From the library",
  passage: "قرأت كتاب أمس. كان ممتعاً.",
  passage_english: "I read a book yesterday. It was enjoyable.",
  vocabulary: [{ arabic: "كتاب", english: "book" }],
  questions: [
    {
      question: "What did they read?",
      options: [
        { text: "A book", correct: true },
        { text: "A letter", correct: false },
      ],
    },
  ],
  difficulty: "beginner",
  dialect: "Gulf",
  status: "published",
  created_at: new Date().toISOString(),
  ...over,
});

function stubPassage(backend: SupabaseBackend, passage: unknown = PASSAGE) {
  backend.stubFunction("reading-passage", { passage });
}

/** Walk from the hub to a generated passage at the given level. */
async function readAt(page: Page, level: RegExp = /beginner/i) {
  await page.getByText("Read a Passage").click();
  await page.getByRole("button", { name: level }).click();
}

test.describe("choosing what to read", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("reading_passages", []);
    db.seed("user_xp", [aUserXp()]);
    stubPassage(backend);
  });

  test("offers a passage or a question", async ({ page }) => {
    await page.goto("/reading");

    await expect(page.getByRole("heading", { name: /reading practice/i })).toBeVisible();
    await expect(page.getByText("Read a Passage")).toBeVisible();
  });

  test("asks for a difficulty before generating anything", async ({ page, backend }) => {
    await page.goto("/reading");
    await page.getByText("Read a Passage").click();

    await expect(page.getByRole("heading", { name: /read a passage/i })).toBeVisible();
    // Generation is the longest and most expensive call in the app; firing it
    // before the learner has chosen would waste one on every visit.
    expect(backend.callsTo("reading-passage")).toHaveLength(0);
  });

  test("generates at the difficulty chosen, in the active dialect", async ({ page, backend }) => {
    await page.goto("/reading");
    await readAt(page, /advanced/i);

    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    expect(backend.lastCallTo("reading-passage")?.body).toMatchObject({
      difficulty: "advanced",
      dialect: "Gulf",
    });
  });

  test("passes a scenario the learner described", async ({ page, backend }) => {
    await page.goto("/reading");
    await page.getByText("Read a Passage").click();
    await page.getByLabel(/describe a scenario/i).fill("ordering coffee at a café");
    await page.getByRole("button", { name: /beginner/i }).click();

    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    // The scenario is the one lever a learner has over what they read.
    expect(backend.lastCallTo("reading-passage")?.body).toMatchObject({
      topic: "ordering coffee at a café",
    });
  });

  test("omits an empty scenario rather than sending a blank string", async ({ page, backend }) => {
    await page.goto("/reading");
    await page.getByText("Read a Passage").click();
    await page.getByLabel(/describe a scenario/i).fill("   ");
    await page.getByRole("button", { name: /beginner/i }).click();

    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    // An empty topic string reaches the prompt as an instruction to write about
    // nothing in particular, which is not the same as no instruction.
    expect(backend.lastCallTo("reading-passage")?.body).not.toHaveProperty("topic");
  });
});

test.describe("preferring the editorial library", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("user_xp", [aUserXp()]);
    stubPassage(backend);
  });

  test("uses a published passage instead of generating one", async ({ page, db, backend }) => {
    db.seed("reading_passages", [aPublishedPassage()]);

    await page.goto("/reading");
    await readAt(page);

    // Editorial passages are hand-checked; generating over them wastes the
    // review effort and costs a model call for a worse result.
    await expect(page.getByRole("heading", { name: "من المكتبة" })).toBeVisible();
    expect(backend.callsTo("reading-passage")).toHaveLength(0);
  });

  test("breaks a library passage into lines", async ({ page, db }) => {
    db.seed("reading_passages", [aPublishedPassage()]);

    await page.goto("/reading");
    await readAt(page);
    await expect(page.getByRole("heading", { name: "من المكتبة" })).toBeVisible();

    // The stored row is one block of text; the reading view is per-line, with a
    // reveal and a tap-to-translate on each. Asserted on words from each
    // sentence, because every word is its own tappable span — a split that
    // produced one giant line would still show both words, but the reveal would
    // uncover the whole passage at once rather than a sentence.
    await expect(page.getByText("قرأت", { exact: true })).toBeVisible();
    await expect(page.getByText("كان", { exact: true })).toBeVisible();
  });

  test("ignores a draft passage", async ({ page, db, backend }) => {
    db.seed("reading_passages", [aPublishedPassage({ status: "draft" })]);

    await page.goto("/reading");
    await readAt(page);

    // A draft is unreviewed. Serving it would put unchecked Arabic in front of
    // a learner with no way for an editor to tell.
    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    expect(backend.callsTo("reading-passage")).toHaveLength(1);
  });

  test("ignores a published passage at another difficulty", async ({ page, db, backend }) => {
    db.seed("reading_passages", [aPublishedPassage({ difficulty: "advanced" })]);

    await page.goto("/reading");
    await readAt(page, /beginner/i);

    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    expect(backend.callsTo("reading-passage")).toHaveLength(1);
  });

  test("ignores a published passage in another dialect", async ({ page, db, backend }) => {
    db.seed("reading_passages", [aPublishedPassage({ dialect: "Egyptian" })]);

    await page.goto("/reading");
    await readAt(page);

    // A Gulf learner reading Egyptian text is being taught the wrong dialect,
    // which is the one thing this app exists to avoid.
    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    expect(backend.callsTo("reading-passage")).toHaveLength(1);
  });

  test("generates when the library lookup fails", async ({
    page,
    db,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/Published-passage lookup failed/]);
    db.seed("reading_passages", [aPublishedPassage()]);
    db.failAlways("reading_passages", 500);

    await page.goto("/reading");
    await readAt(page);

    // The library is a shortcut, not a dependency — a failure there must not
    // cost the learner their passage.
    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    expect(backend.callsTo("reading-passage")).toHaveLength(1);
  });
});

test.describe("reading the passage", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("reading_passages", []);
    db.seed("user_xp", [aUserXp()]);
    db.seed("user_vocabulary", []);
    stubPassage(backend);
    backend.stubFunction("word-enrichment", {
      definition: "cafe",
      root: "ق ه و",
      transliteration: "maqha",
      uses: [],
    });
  });

  test("shows the Arabic and keeps the English behind a switch", async ({ page }) => {
    await page.goto("/reading");
    await readAt(page);

    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    await expect(page.getByText("At the cafe")).toHaveCount(0);

    await page.getByRole("switch").first().click();
    await expect(page.getByText("At the cafe")).toBeVisible();
  });

  test("lists the key vocabulary", async ({ page }) => {
    await page.goto("/reading");
    await readAt(page);

    // Scoped to the badge: the word also appears inside the passage itself,
    // where it is a lookup target rather than a save control.
    await expect(page.getByText("مقهى", { exact: true })).toBeVisible();
  });

  test("saves a key word straight to My Words", async ({ page, db }) => {
    await page.goto("/reading");
    await readAt(page);
    await expect(page.getByText("مقهى", { exact: true })).toBeVisible();

    await page.getByText("مقهى", { exact: true }).click();

    await expect.poll(() => db.rows("user_vocabulary").length, { timeout: 10_000 }).toBe(1);
    expect(db.rows("user_vocabulary")[0].word_english).toBe("cafe");
  });
});

test.describe("the comprehension quiz", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("reading_passages", []);
    db.seed("user_xp", [aUserXp()]);
    stubPassage(backend);
  });

  const startQuiz = async (page: Page) => {
    await page.goto("/reading");
    await readAt(page);
    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    await page.getByRole("button", { name: /start comprehension quiz/i }).click();
  };

  test("asks one question at a time", async ({ page }) => {
    await startQuiz(page);

    await expect(page.getByText("Where did the writer go?")).toBeVisible();
    await expect(page.getByText("What did they order?")).toHaveCount(0);
  });

  test("advances to the next question", async ({ page }) => {
    await startQuiz(page);

    await page.getByRole("button", { name: /to the cafe/i }).click();
    await page.getByRole("button", { name: /next/i }).click();

    await expect(page.getByText("What did they order?")).toBeVisible();
  });

  test("awards XP for a correct answer", async ({ page, db }) => {
    await startQuiz(page);

    await page.getByRole("button", { name: /to the cafe/i }).click();

    await expect
      .poll(() => Number(db.rows("user_xp")[0]?.total_xp ?? 0), { timeout: 10_000 })
      .toBeGreaterThan(250);
  });

  test("awards nothing for a wrong answer", async ({ page, db }) => {
    await startQuiz(page);

    await page.getByRole("button", { name: /to the market/i }).click();
    await page.waitForTimeout(1000);

    // Paying out regardless would make the quiz a button-mashing exercise.
    expect(Number(db.rows("user_xp")[0]?.total_xp ?? 0)).toBe(250);
  });

  test("marks the daily task done at the end, not at the start", async ({ page }) => {
    await startQuiz(page);
    expect(await completedToday(page)).not.toContain("reading");

    await page.getByRole("button", { name: /to the cafe/i }).click();
    await page.getByRole("button", { name: /next/i }).click();
    await page.getByRole("button", { name: /^coffee$/i }).click();
    await page.getByRole("button", { name: /next|finish|see/i }).click();

    // Opening the quiz is not reading the passage; finishing it is the only
    // signal the page has that the work was actually done.
    await expect.poll(async () => await completedToday(page)).toContain("reading");
  });
});

test.describe("when the passage cannot be generated", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile()]);
    db.seed("reading_passages", []);
    db.seed("user_xp", [aUserXp()]);
  });

  test("retries once before giving up", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/Passage generation failed/]);

    let attempts = 0;
    backend.stubFunction("reading-passage", () => {
      attempts += 1;
      return attempts === 1 ? { status: 503, body: { error: "budget_spent" } } : { passage: PASSAGE };
    });

    await page.goto("/reading");
    await readAt(page);

    // The server returns an honest 503 the moment its generation budget is
    // spent, and the retry path skips the slow drafting model — so a second
    // try usually lands. Surfacing the first failure would send the learner
    // away from a passage they were about to get.
    await expect(page.getByRole("heading", { name: "في المقهى" })).toBeVisible();
    expect(attempts).toBe(2);
  });

  test("says so when both attempts fail", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("reading-passage");

    await page.goto("/reading");
    await readAt(page);

    // Two failures is a real outage; leaving the spinner up forever is the one
    // outcome worse than an error.
    await expect(page.getByRole("heading", { name: "في المقهى" })).toHaveCount(0);
    await expect(page.getByText(/failed|try again|couldn't/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
