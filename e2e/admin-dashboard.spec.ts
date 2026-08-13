import { expect, test, type Page } from "./support/fixtures";
import {
  aLesson,
  aVocabularyWord,
  lessonId,
  many,
  TEST_USER_ID,
  wordId,
} from "../src/test/support/factories";

/**
 * `/admin` — the landing page every admin route redirects through.
 *
 * It is three things at once: a counter (lessons, words, average), a launcher
 * whose tiles differ per role, and a lesson list. The role branching is what
 * makes it worth testing directly — a recorder and a content reviewer see
 * entirely different sets of tiles, and the tiles they do not see are the only
 * thing stopping them walking into a page the layout would then bounce them
 * out of.
 */

/** A launcher tile, located by its heading rather than by role — most are bare divs. */
const tile = (page: Page, name: string) =>
  page.locator("h3").filter({ hasText: new RegExp(`^${name}$`) });

test.describe("the counters", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("counts lessons and words for the active dialect", async ({ page, db }) => {
    db.seed("lessons", [
      aLesson({ id: lessonId(0), dialect_module: "Gulf" }),
      aLesson({ id: lessonId(1), dialect_module: "Gulf", display_order: 2 }),
      aLesson({ id: lessonId(2), dialect_module: "Egyptian" }),
    ]);
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), lesson_id: lessonId(0), dialect_module: "Gulf" }),
      aVocabularyWord({ id: wordId(1), lesson_id: lessonId(0), dialect_module: "Gulf" }),
      aVocabularyWord({ id: wordId(2), lesson_id: lessonId(2), dialect_module: "Egyptian" }),
    ]);

    await page.goto("/admin");

    await expect(page.getByText("Total Lessons").locator("..")).toContainText("2");
    await expect(page.getByText("Total Words").locator("..")).toContainText("2");
    await expect(page.getByText("Average Words/Lesson").locator("..")).toContainText("1");
  });

  test("avoids dividing by zero when there are no lessons", async ({ page, db }) => {
    db.seed("lessons", []);
    db.seed("vocabulary_words", [aVocabularyWord({ dialect_module: "Gulf" })]);

    await page.goto("/admin");

    await expect(page.getByText("Average Words/Lesson").locator("..")).toContainText("0");
  });

  test("recounts when the dialect changes", async ({ page, db }) => {
    db.seed("lessons", [
      aLesson({ id: lessonId(0), title: "Gulf lesson", dialect_module: "Gulf" }),
      aLesson({ id: lessonId(1), title: "Cairo lesson", dialect_module: "Egyptian" }),
      aLesson({ id: lessonId(2), title: "Cairo two", dialect_module: "Egyptian", display_order: 2 }),
    ]);
    db.seed("vocabulary_words", []);

    await page.goto("/admin");
    await expect(page.getByText("Gulf lesson")).toBeVisible();

    await page.getByRole("button", { name: /Egyptian Arabic/ }).click();

    await expect(page.getByText("Cairo lesson")).toBeVisible();
    await expect(page.getByText("Gulf lesson")).toHaveCount(0);
    await expect(page.getByText("Total Lessons").locator("..")).toContainText("2");
  });
});

test.describe("the lesson list", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("shows each lesson with its word count", async ({ page, db }) => {
    db.seed("lessons", [
      aLesson({ id: lessonId(0), title: "Greetings", title_arabic: "تحيات", icon: "👋" }),
    ]);
    db.seed("vocabulary_words", many(aVocabularyWord, 3, (index) => ({
      id: wordId(index),
      lesson_id: lessonId(0),
    })));

    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Greetings" })).toBeVisible();
    await expect(page.getByText("تحيات")).toBeVisible();
    await expect(page.getByText("3 words")).toBeVisible();
    await expect(page.getByText("👋")).toBeVisible();
  });

  test("opens a lesson's vocabulary", async ({ page, db }) => {
    db.seed("lessons", [aLesson({ id: lessonId(0), title: "Greetings" })]);
    db.seed("vocabulary_words", []);

    await page.goto("/admin");
    await page.getByRole("heading", { name: "Greetings" }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/lessons/${lessonId(0)}/words$`));
  });

  test("offers an admin a way to make the first lesson", async ({ page, db }) => {
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);

    await page.goto("/admin");

    await expect(page.getByText(/no lessons yet/i)).toBeVisible();
    await page.getByRole("button", { name: /create lesson/i }).click();

    await expect(page).toHaveURL(/\/admin\/curriculum-builder$/);
  });

  test("orders lessons by their display order", async ({ page, db }) => {
    db.seed("lessons", [
      aLesson({ id: lessonId(0), title: "Second", display_order: 2 }),
      aLesson({ id: lessonId(1), title: "First", display_order: 1 }),
    ]);
    db.seed("vocabulary_words", []);

    await page.goto("/admin");

    const headings = page.locator("h4");
    await expect(headings.first()).toHaveText("First");
    await expect(headings.last()).toHaveText("Second");
  });
});

test.describe("what an admin can launch", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin", { email: "admin@example.com" });
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);
  });

  test("names the role and the account", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
    await expect(page.getByText("admin@example.com")).toBeVisible();
  });

  test("offers every admin area", async ({ page }) => {
    await page.goto("/admin");

    for (const name of [
      "Curriculum Builder",
      "Import Lesson Plan",
      "Curriculum",
      "Manage Topics",
      "Manage Videos",
      "Memes",
      "Set Phrases",
      "Dialect Rulebook",
      "Interactive Stories",
      "Reading Library",
      "Trending Videos",
      "Bible Access",
      "Bible Lessons",
      "Curriculum Coverage",
      "Feature Metrics",
      "Error Log",
      "Beta Invite Codes",
      "Beta Feedback",
    ]) {
      await expect(tile(page, name)).toBeVisible();
    }
  });

  test("each tile opens its area", async ({ page }) => {
    const routes: Array<[string, RegExp]> = [
      ["Curriculum Builder", /\/admin\/curriculum-builder$/],
      ["Import Lesson Plan", /\/admin\/lessons\/import$/],
      ["Curriculum", /\/admin\/curriculum$/],
      ["Manage Topics", /\/admin\/topics$/],
      ["Manage Videos", /\/admin\/videos$/],
      ["Memes", /\/admin\/memes$/],
      ["Set Phrases", /\/admin\/set-phrases$/],
      ["Curriculum Coverage", /\/admin\/coverage$/],
      ["Beta Invite Codes", /\/admin\/invite-codes$/],
    ];

    for (const [name, url] of routes) {
      await page.goto("/admin");
      await tile(page, name).click();
      await expect(page).toHaveURL(url);
    }
  });

  test("links out to the learner app", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: /view app/i }).click();

    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });

  test("signs out to the admin login", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: /sign out/i }).click();

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

test.describe("what a recorder can launch", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("recorder");
    db.seed("vocabulary_words", []);
  });

  test("explains the role instead of offering admin tiles", async ({ page, db }) => {
    db.seed("lessons", []);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Recorder Dashboard" })).toBeVisible();
    await expect(tile(page, "Recorder Access")).toBeVisible();
    await expect(tile(page, "Curriculum Builder")).toHaveCount(0);
    await expect(tile(page, "Manage Videos")).toHaveCount(0);
    await expect(tile(page, "Beta Invite Codes")).toHaveCount(0);
  });

  test("still reaches a lesson's words, which is the whole job", async ({ page, db }) => {
    db.seed("lessons", [aLesson({ id: lessonId(0), title: "Greetings" })]);
    await page.goto("/admin");

    await expect(page.getByText(/add words or record audio/i)).toBeVisible();
    await page.getByRole("heading", { name: "Greetings" }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/lessons/${lessonId(0)}/words$`));
  });

  test("is told to ask an admin when there are no lessons", async ({ page, db }) => {
    db.seed("lessons", []);
    await page.goto("/admin");

    await expect(page.getByText(/ask an admin to create lessons/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /create lesson/i })).toHaveCount(0);
  });
});

test.describe("what a content reviewer can launch", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("content_reviewer");
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);
  });

  test("offers only the three areas the role may open", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Content Reviewer Dashboard" })).toBeVisible();
    await expect(tile(page, "Content Reviewer Access")).toBeVisible();
    await expect(tile(page, "Manage Video Content")).toBeVisible();
    await expect(tile(page, "Set Phrases")).toBeVisible();
    await expect(tile(page, "Dialect Rulebook")).toBeVisible();
    await expect(tile(page, "Curriculum Builder")).toHaveCount(0);
    await expect(tile(page, "Memes")).toHaveCount(0);
  });

  test("its tiles lead somewhere the role is allowed", async ({ page }) => {
    // The launcher and rbac.ts have to agree. A tile pointing at a path the
    // allow-list rejects would bounce the reviewer back here with a toast.
    for (const [name, url] of [
      ["Manage Video Content", /\/admin\/videos$/],
      ["Set Phrases", /\/admin\/set-phrases$/],
      ["Dialect Rulebook", /\/admin\/dialect-rules$/],
    ] as Array<[string, RegExp]>) {
      await page.goto("/admin");
      await tile(page, name).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByText(/access denied/i)).toHaveCount(0);
    }
  });

  test("still sees the lesson list it cannot act on", async ({ page, db }) => {
    // Pinned, not fixed. The overview is rendered for every role, and clicking
    // a lesson navigates to /admin/lessons/:id/words — a path rbac.ts does not
    // allow-list, so a reviewer is bounced back with "Access Denied".
    db.seed("lessons", [aLesson({ id: lessonId(0), title: "Greetings" })]);
    await page.goto("/admin");

    await page.getByRole("heading", { name: "Greetings" }).click();

    await expect(page.getByText(/access denied/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe("when the data will not load", () => {
  test("shows a spinner forever rather than an error", async ({ page, signInAs, db }) => {
    // Pinned, not fixed. `useLessons` rethrows, but the dashboard only branches
    // on `isLoading` — a failed lessons query leaves `lessonsLoading` false and
    // `lessons` undefined, so the page renders with an empty overview and no
    // hint that anything went wrong.
    await signInAs("admin");
    db.seed("lessons", [aLesson({ id: lessonId(0), title: "Greetings" })]);
    db.seed("vocabulary_words", []);
    db.failAlways("lessons", 500);

    await page.goto("/admin");

    await expect(page.getByText(/no lessons yet/i)).toBeVisible();
    // "Error Log" is one of the launcher tiles, so the check has to be for a
    // failure message rather than for the word.
    await expect(page.getByText(/failed to load|could not load|try again/i)).toHaveCount(0);
  });

  test("counts zero words when the count query fails", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.seed("lessons", []);
    db.seed("vocabulary_words", [aVocabularyWord({ dialect_module: "Gulf" })]);
    db.failAlways("vocabulary_words", 500);

    await page.goto("/admin");

    await expect(page.getByText("Total Words").locator("..")).toContainText("0");
  });
});

test.describe("who can open it", () => {
  test("a signed-in learner is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("a signed-out visitor is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("the alerts bell is admin-only", async ({ page, signInAs, db }) => {
    db.seed("lessons", []);
    db.seed("vocabulary_words", []);

    await signInAs("recorder", { userId: TEST_USER_ID });
    await page.goto("/admin");
    await expect(page.locator("button:has(svg.lucide-bell)")).toHaveCount(0);
  });
});
