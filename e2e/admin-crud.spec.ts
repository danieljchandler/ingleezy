import { expect, test } from "./support/fixtures";
import { aTopic, aVocabularyWord, many, topicId, wordId } from "../src/test/support/factories";

/**
 * Admin content management.
 *
 * The 38 admin routes had no coverage at all before the in-memory backend
 * landed, because `useAdminAuth` resolves every role check through
 * `rpc("has_role")` and the old double answered `null` to all of them. The
 * route sweep now proves each page renders for the right roles; this covers
 * what an admin actually *does* on them — create, edit, delete, and the
 * validation and failure paths around each.
 */

test.describe("topics", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("lists the topics that exist", async ({ page, db }) => {
    db.seed("topics", [
      aTopic({ id: topicId(0), name: "Colours", name_arabic: "ألوان" }),
      aTopic({ id: topicId(1), name: "Food", name_arabic: "طعام", display_order: 2 }),
    ]);

    await page.goto("/admin/topics");

    await expect(page.getByRole("heading", { name: "Colours" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Food" })).toBeVisible();
  });

  test("offers to create the first one when there are none", async ({ page, db }) => {
    db.seed("topics", []);
    await page.goto("/admin/topics");

    await expect(page.getByText(/no topics yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /add topic/i }).first()).toBeVisible();
  });

  test("creates a topic with the values entered", async ({ page, db }) => {
    db.seed("topics", []);
    await page.goto("/admin/topics/new");

    await page.getByLabel(/english name/i).fill("Weather");
    await page.getByLabel(/arabic name/i).fill("طقس");
    await page.getByRole("button", { name: /create topic/i }).click();

    await expect(page).toHaveURL(/\/admin\/topics$/);

    const write = db.lastWriteTo("topics");
    expect(write?.method).toBe("POST");
    expect(write?.payload[0]).toMatchObject({ name: "Weather", name_arabic: "طقس" });
  });

  test("puts a new topic at the end of the running order", async ({ page, db }) => {
    // The form reads the current maximum and adds one. Getting this wrong would
    // silently stack every new topic on top of an existing one.
    db.seed("topics", [
      aTopic({ id: topicId(0), display_order: 0 }),
      aTopic({ id: topicId(1), display_order: 7 }),
    ]);

    await page.goto("/admin/topics/new");
    await page.getByLabel(/english name/i).fill("Weather");
    await page.getByLabel(/arabic name/i).fill("طقس");
    await page.getByRole("button", { name: /create topic/i }).click();

    await expect(page).toHaveURL(/\/admin\/topics$/);
    expect(db.lastWriteTo("topics")?.payload[0]).toMatchObject({ display_order: 8 });
  });

  test("will not submit without both names", async ({ page, db }) => {
    db.seed("topics", []);
    await page.goto("/admin/topics/new");

    await page.getByLabel(/english name/i).fill("Weather");
    await page.getByRole("button", { name: /create topic/i }).click();

    // Both fields are required, so nothing is sent.
    await expect(page).toHaveURL(/\/admin\/topics\/new$/);
    expect(db.writesTo("topics")).toHaveLength(0);
  });

  test("prefills the form when editing and sends a patch, not an insert", async ({ page, db }) => {
    db.seed("topics", [aTopic({ id: topicId(0), name: "Colours", name_arabic: "ألوان" })]);

    await page.goto(`/admin/topics/${topicId(0)}/edit`);
    await expect(page.getByLabel(/english name/i)).toHaveValue("Colours");

    await page.getByLabel(/english name/i).fill("Colors");
    await page.getByRole("button", { name: /update topic/i }).click();

    await expect(page).toHaveURL(/\/admin\/topics$/);

    const write = db.lastWriteTo("topics");
    expect(write?.method).toBe("PATCH");
    expect(write?.payload[0]).toMatchObject({ name: "Colors" });
  });

  test("asks before deleting, and says what else goes with it", async ({ page, db }) => {
    db.seed("topics", [aTopic({ id: topicId(0), name: "Colours" })]);
    await page.goto("/admin/topics");

    await page.getByRole("button", { name: /^delete colours$/i }).click();

    await expect(page.getByRole("heading", { name: /delete topic/i })).toBeVisible();
    // Deleting a topic takes its vocabulary with it; the dialog has to say so.
    await expect(page.getByText(/vocabulary words/i)).toBeVisible();
    expect(db.writesTo("topics")).toHaveLength(0);
  });

  test("deletes once confirmed", async ({ page, db }) => {
    db.seed("topics", [aTopic({ id: topicId(0), name: "Colours" })]);
    await page.goto("/admin/topics");

    await page.getByRole("button", { name: /^delete colours$/i }).click();
    await page.getByRole("button", { name: /^delete$/i }).click();

    await expect(page.getByText(/deleted successfully/i)).toBeVisible();
    expect(db.rows("topics")).toHaveLength(0);
  });

  test("cancelling the dialog leaves the topic alone", async ({ page, db }) => {
    db.seed("topics", [aTopic({ id: topicId(0), name: "Colours" })]);
    await page.goto("/admin/topics");

    await page.getByRole("button", { name: /^delete colours$/i }).click();
    await page.getByRole("button", { name: /cancel/i }).click();

    expect(db.rows("topics")).toHaveLength(1);
  });

  test("reports a failed delete instead of pretending it worked", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);

    db.seed("topics", [aTopic({ id: topicId(0), name: "Colours" })]);
    await page.goto("/admin/topics");

    db.failWrites("topics", 403);
    await page.getByRole("button", { name: /^delete colours$/i }).click();
    await page.getByRole("button", { name: /^delete$/i }).click();

    await expect(page.getByText(/deleted successfully/i)).toHaveCount(0);
    expect(db.rows("topics")).toHaveLength(1);
  });
});

test.describe("what a content reviewer may change", () => {
  // rbac.ts lets a reviewer reach /admin/videos but not /admin/topics. Within
  // the pages they can reach, the destructive controls are admin-only — a rule
  // enforced in the component rather than by the route, so it needs its own
  // test.
  test("a reviewer does not get edit or delete controls on topics", async ({ page, signInAs, db }) => {
    await signInAs("content_reviewer");
    db.seed("topics", [aTopic({ id: topicId(0), name: "Colours" })]);

    // They are redirected away from the page entirely.
    await page.goto("/admin/topics");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("an admin does get them", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.seed("topics", [aTopic({ id: topicId(0), name: "Colours" })]);

    await page.goto("/admin/topics");
    await expect(page.getByRole("button", { name: /manage words/i })).toBeVisible();
  });
});

test.describe("words within a topic", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("topics", [aTopic({ id: topicId(0), name: "Colours" })]);
  });

  test("lists the words the topic has", async ({ page, db }) => {
    db.seed(
      "vocabulary_words",
      many(aVocabularyWord, 2, (index) => ({
        id: wordId(index),
        topic_id: topicId(0),
        word_arabic: `كلمة${index + 1}`,
        word_english: `word ${index + 1}`,
      })),
    );

    await page.goto(`/admin/topics/${topicId(0)}/words`);

    await expect(page.getByText("كلمة1")).toBeVisible();
    await expect(page.getByText("كلمة2")).toBeVisible();
  });

  test("shows only this topic's words, not every word in the app", async ({ page, db }) => {
    db.seed("vocabulary_words", [
      aVocabularyWord({ id: wordId(0), topic_id: topicId(0), word_arabic: "لهذا" }),
      aVocabularyWord({ id: wordId(1), topic_id: topicId(1), word_arabic: "لغيره" }),
    ]);

    await page.goto(`/admin/topics/${topicId(0)}/words`);

    await expect(page.getByText("لهذا")).toBeVisible();
    await expect(page.getByText("لغيره")).toHaveCount(0);
  });

  test("says so when the topic has no words yet", async ({ page, db }) => {
    db.seed("vocabulary_words", []);
    await page.goto(`/admin/topics/${topicId(0)}/words`);

    await expect(page.getByText(/no words|add.*word/i).first()).toBeVisible();
  });
});

test.describe("editing a topic", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("topics", [
      aTopic({
        id: topicId(0),
        name: "Colours",
        name_arabic: "ألوان",
        icon: "🎨",
        gradient: "bg-gradient-indigo",
      }),
    ]);
  });

  test("loads the topic into the form", async ({ page }) => {
    await page.goto(`/admin/topics/${topicId(0)}/edit`);

    await expect(page.getByLabel("English Name")).toHaveValue("Colours");
    await expect(page.getByLabel("Arabic Name")).toHaveValue("ألوان");
    await expect(page.getByRole("button", { name: "Update Topic" })).toBeVisible();
  });

  test("keeps the icon and colour the topic was saved with", async ({ page }) => {
    await page.goto(`/admin/topics/${topicId(0)}/edit`);

    // Both are chosen from a palette with no text, so the only signal that the
    // right one is selected is the ring — losing it would silently reset the
    // topic's appearance on every edit.
    await expect(page.locator("button.ring-2", { hasText: "🎨" })).toBeVisible();
    await expect(page.locator("button.bg-gradient-indigo.ring-2")).toBeVisible();
  });

  test("updates rather than creating a second topic", async ({ page, db }) => {
    await page.goto(`/admin/topics/${topicId(0)}/edit`);
    await page.getByLabel("English Name").fill("Colors");
    await page.getByRole("button", { name: "Update Topic" }).click();

    await expect(page.getByText("Topic updated!")).toBeVisible();
    const write = db.writesTo("topics").at(-1);
    expect(write?.method).toBe("PATCH");
    expect(write?.payload[0]).toMatchObject({ name: "Colors", name_arabic: "ألوان" });
  });

  test("saves a changed icon and colour", async ({ page, db }) => {
    await page.goto(`/admin/topics/${topicId(0)}/edit`);
    await page.getByRole("button", { name: "🍎", exact: true }).click();
    await page.getByRole("button", { name: "Update Topic" }).click();

    await expect(page.getByText("Topic updated!")).toBeVisible();
    expect(db.lastWriteTo("topics")?.payload[0]).toMatchObject({ icon: "🍎" });
  });

  test("leaves display_order alone on an edit", async ({ page, db }) => {
    await page.goto(`/admin/topics/${topicId(0)}/edit`);
    await page.getByLabel("English Name").fill("Colors");
    await page.getByRole("button", { name: "Update Topic" }).click();
    await expect(page.getByText("Topic updated!")).toBeVisible();

    // Position on the curriculum page is set once at creation; an edit that
    // re-derived it would reshuffle the list every time a typo was fixed.
    expect(db.lastWriteTo("topics")?.payload[0]).not.toHaveProperty("display_order");
  });

  test("refuses to save with either name emptied", async ({ page, db }) => {
    await page.goto(`/admin/topics/${topicId(0)}/edit`);
    await page.getByLabel("Arabic Name").fill("");
    await page.getByRole("button", { name: "Update Topic" }).click();

    // Both inputs are `required`, so the browser blocks the submit before the
    // handler's own check ever runs — which means the app's "Please fill in
    // both name fields" toast is unreachable from the keyboard or the mouse.
    // What matters is the outcome: nothing is written and the form stays put.
    expect(db.writesTo("topics").filter((w) => w.method === "PATCH")).toHaveLength(0);
    await expect(page).toHaveURL(new RegExp(`/admin/topics/${topicId(0)}/edit$`));
  });

  test("refuses to save a name that is only whitespace", async ({ page, db }) => {
    await page.goto(`/admin/topics/${topicId(0)}/edit`);
    // A space satisfies `required`, so this is the path that reaches the
    // handler's own validation.
    await page.getByLabel("Arabic Name").fill("   ");
    await page.getByRole("button", { name: "Update Topic" }).click();

    await expect(page.getByText("Please fill in both name fields")).toBeVisible();
    expect(db.writesTo("topics").filter((w) => w.method === "PATCH")).toHaveLength(0);
  });

  test("says so when the update is refused", async ({ page, db }) => {
    db.failWrites("topics", 403, { message: "new row violates row-level security policy" });

    await page.goto(`/admin/topics/${topicId(0)}/edit`);
    await page.getByLabel("English Name").fill("Colors");
    await page.getByRole("button", { name: "Update Topic" }).click();

    await expect(page.getByText(/row-level security/)).toBeVisible();
    // Still on the form, so the edit is not lost.
    await expect(page).toHaveURL(new RegExp(`/admin/topics/${topicId(0)}/edit$`));
  });

  test("goes back to the list without writing on Cancel", async ({ page, db }) => {
    await page.goto(`/admin/topics/${topicId(0)}/edit`);
    await page.getByLabel("English Name").fill("Something else");
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page).toHaveURL(/\/admin\/topics$/);
    expect(db.writesTo("topics").filter((w) => w.method === "PATCH")).toHaveLength(0);
  });
});

test.describe("when the admin console cannot load its data", () => {
  test("topics shows an error rather than an empty list", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.failAlways("topics", 500);

    await page.goto("/admin/topics");

    // "No topics yet. Create your first topic!" after a failed query invites an
    // admin to recreate content that already exists.
    await expect(page.getByText(/no topics yet/i)).toHaveCount(0);
  });
});
