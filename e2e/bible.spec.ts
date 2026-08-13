import { expect, test } from "./support/fixtures";
import { aRole, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The Bible material, and the gate in front of it.
 *
 * Unusual in this app: `/bible*` has no route-level guard at all. Every other
 * restricted area either redirects (ProtectedRoute) or renders a paywall in
 * place (RequireSubscription); these two pages check a boolean themselves and
 * render a lock screen. That makes the in-page check the entire access control,
 * so a page that rendered its content before the check settled would leak it
 * for a frame — and there is no second line of defence behind it.
 *
 * The rule is admin OR (bible_reader AND NOT content_reviewer), enforced in SQL
 * by `has_bible_access`. The exclusion is deliberate: content reviewers are
 * contractors checking dialect quality, and this material is not theirs.
 */

/** The id `seedLessons` gives the first row. */
const LESSON = "bbbbbbbb-0000-4000-8000-000000000000";

const aBibleLesson = (over: Record<string, unknown> = {}) => ({
  id: LESSON,
  title: "The Good Samaritan",
  description: "Luke 10",
  book_name: "Luke",
  book_usfm: "LUK",
  chapter: 10,
  verse_start: 25,
  verse_end: 37,
  dialect: "Gulf",
  published: true,
  display_order: 1,
  // Plain strings, one per verse, in the order the admin form writes them —
  // the columns are untyped JSON, so the shape is a convention rather than
  // something the schema enforces.
  formal_verses: ["وإذا ناموسي قام", "فقال له يسوع"],
  dialect_verses: ["وفجأة واحد فقيه قام", "قال له عيسى"],
  english_verses: ["And behold, a lawyer stood up", "Jesus said to him"],
  cultural_note: null,
  created_by: TEST_USER_ID,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

function seedLessons(db: MemoryDb, rows: Array<Record<string, unknown>> = [{}]) {
  db.seed(
    "bible_lessons",
    rows.map((row, index) => aBibleLesson({ id: `bbbbbbbb-0000-4000-8000-00000000000${index}`, ...row })),
  );
}

test.describe("who can reach the Bible pages", () => {
  test("a bible reader is let in", async ({ page, signInAs, db }) => {
    await signInAs("bible_reader");
    seedLessons(db);

    await page.goto("/bible/lessons");

    await expect(page.getByRole("heading", { name: "The Good Samaritan" })).toBeVisible();
  });

  test("an admin is let in", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    seedLessons(db);

    await page.goto("/bible/lessons");

    await expect(page.getByRole("heading", { name: "The Good Samaritan" })).toBeVisible();
  });

  test("a plain learner gets the lock screen", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedLessons(db);

    await page.goto("/bible/lessons");

    await expect(page.getByText(/available by invitation only/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "The Good Samaritan" })).toHaveCount(0);
  });

  test("a content reviewer gets the lock screen", async ({ page, signInAs, db }) => {
    await signInAs("content_reviewer");
    seedLessons(db);

    await page.goto("/bible/lessons");

    await expect(page.getByText(/available by invitation only/i)).toBeVisible();
  });

  test("a bible reader who is also a content reviewer is shut out", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("bible_reader");
    db.add("user_roles", aRole("content_reviewer"));
    seedLessons(db);

    // The case the AND NOT exists for: taking on a review shift has to revoke
    // reading access rather than sitting alongside it.
    await page.goto("/bible/lessons");

    await expect(page.getByText(/available by invitation only/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "The Good Samaritan" })).toHaveCount(0);
  });

  test("an admin who is also a content reviewer keeps access", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.add("user_roles", aRole("content_reviewer"));
    seedLessons(db);

    // Admin wins outright, or an admin could lock themselves out by helping
    // with a review.
    await page.goto("/bible/lessons");
    await expect(page.getByRole("heading", { name: "The Good Samaritan" })).toBeVisible();
  });

  test("a signed-out visitor is told to sign in", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    seedLessons(db);

    await page.goto("/bible/lessons");

    // Different wording from the invitation message: one is fixable by signing
    // in, the other is not.
    await expect(page.getByText(/please sign in/i)).toBeVisible();
  });

  test("does not query the lessons for someone without access", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedLessons(db);

    await page.goto("/bible/lessons");
    await expect(page.getByText(/available by invitation only/i)).toBeVisible();

    // The gate is the whole access control here — there is no route guard and
    // no second check. Fetching first and hiding afterwards would put the
    // material in the network tab of everyone who visits.
    expect(db.readsOf("bible_lessons")).toHaveLength(0);
  });

  test("shuts the reading page too, not only the lessons list", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/bible");

    await expect(page.getByText(/available by invitation only/i)).toBeVisible();
  });
});

test.describe("the lesson list", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("bible_reader");
  });

  test("shows published lessons for the active dialect", async ({ page, db }) => {
    seedLessons(db, [
      { title: "Gulf lesson", dialect: "Gulf" },
      { title: "Egyptian lesson", dialect: "Egyptian" },
    ]);

    await page.goto("/bible/lessons");

    await expect(page.getByRole("heading", { name: "Gulf lesson" })).toBeVisible();
    await expect(page.getByText("Egyptian lesson")).toHaveCount(0);
  });

  test("hides an unpublished lesson", async ({ page, db }) => {
    seedLessons(db, [
      { title: "Live one", published: true },
      { title: "Draft one", published: false },
    ]);

    await page.goto("/bible/lessons");

    // A draft is unreviewed translation work; showing it would put unchecked
    // scripture in front of a reader.
    await expect(page.getByRole("heading", { name: "Live one" })).toBeVisible();
    await expect(page.getByText("Draft one")).toHaveCount(0);
  });

  test("orders lessons the way the editor arranged them", async ({ page, db }) => {
    seedLessons(db, [
      { title: "Second", display_order: 2 },
      { title: "First", display_order: 1 },
    ]);

    await page.goto("/bible/lessons");

    const headings = page.getByRole("heading", { level: 3 });
    await expect(headings.first()).toHaveText("First");
  });

  test("says so when there is nothing to read yet", async ({ page, db }) => {
    db.seed("bible_lessons", []);

    await page.goto("/bible/lessons");

    await expect(page.getByText(/no lessons|nothing here|check back/i).first()).toBeVisible();
  });

  test("reports a failed load rather than an empty library", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedLessons(db);
    db.failAlways("bible_lessons", 500);

    await page.goto("/bible/lessons");

    await expect(page.getByText(/failed to load lessons/i)).toBeVisible();
  });
});

test.describe("reading a lesson", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("bible_reader");
    seedLessons(db);
  });

  test("opens from the list", async ({ page }) => {
    await page.goto("/bible/lessons");
    await page.getByRole("heading", { name: "The Good Samaritan" }).click();

    await expect(page).toHaveURL(new RegExp(`/bible/lessons/${LESSON}$`));
  });

  test("shows the dialect rendering, word by word", async ({ page }) => {
    await page.goto(`/bible/lessons/${LESSON}`);

    // Rendered through TappableArabicText, so each word is its own lookup
    // target rather than one block of text.
    await expect(page.getByRole("button", { name: /Look up “وفجأة”/ })).toBeVisible();
  });

  test("keeps the formal Arabic and the English off until asked", async ({ page }) => {
    await page.goto(`/bible/lessons/${LESSON}`);
    await expect(page.getByRole("button", { name: /Look up “وفجأة”/ })).toBeVisible();

    // The dialect is the point of the material; the formal text and the English
    // are there to check against, and showing all three at once buries it.
    await expect(page.getByRole("switch", { name: "Formal Arabic" })).not.toBeChecked();
    await expect(page.getByText("And behold, a lawyer stood up")).toHaveCount(0);

    await page.getByRole("switch", { name: "English" }).click();
    await expect(page.getByText("And behold, a lawyer stood up")).toBeVisible();
  });

  test("opens on a direct link without the list loaded first", async ({ page }) => {
    await page.goto(`/bible/lessons/${LESSON}`);

    // Deep links are how these get shared; the page fetches the single lesson
    // rather than relying on the list having been visited.
    await expect(page.getByText("The Good Samaritan")).toBeVisible();
  });

  test("numbers the verses from where the passage starts", async ({ page }) => {
    await page.goto(`/bible/lessons/${LESSON}`);

    // The stored arrays have no verse numbers in them; the numbering is derived
    // from `verse_start` plus the index, so an off-by-one here mislabels every
    // verse in the passage.
    await expect(page.getByText("Verse 25")).toBeVisible();
    await expect(page.getByText("Verse 26")).toBeVisible();
  });

  test("crashes on a verse array holding anything but strings", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/displayText\.split is not a function/, /ErrorBoundary caught error/]);
    seedLessons(db, [{ dialect_verses: [{ verse: 25, text: "وفجأة" }] }]);

    await page.goto(`/bible/lessons/${LESSON}`);

    // Recording a limit rather than a bug in normal use: the columns are
    // untyped JSON and the page guards with `Array.isArray`, which checks the
    // outer shape and not the elements. Only the admin form writes these, and
    // it writes strings — but a hand-edited row or an older writer takes the
    // whole route down with an error boundary rather than skipping a verse.
    await expect(page.getByRole("heading", { name: /something went wrong/i })).toBeVisible();
  });
});
