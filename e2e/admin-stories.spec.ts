import { expect, test } from "./support/fixtures";
import {
  anAuthenticStory,
  anInteractiveStory,
  daysAgo,
  iso,
  many,
  storyId,
} from "../src/test/support/factories";

/**
 * The two story libraries: `/admin/stories` (branching, choose-your-adventure)
 * and `/admin/reading-library` (authentic public-domain texts).
 *
 * They look alike and behave differently. Interactive stories are ordered by a
 * hand-set `display_order` and publish from the list; authentic stories are
 * ordered by recency, have no publish toggle at all, and carry a second status
 * for their generated audio.
 *
 * The reading library also holds the one place in the admin where three edge
 * functions run back to back on a single click — suggest, write, import — and
 * a failure anywhere in that chain has to leave the admin somewhere sensible.
 */

const STORY = "b1b1b1b1-0000-4000-8000-000000000000";
const storyIdAt = (index: number) =>
  `b1b1b1b1-0000-4000-8000-${String(index).padStart(12, "0")}`;

test.describe("interactive stories", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("offers to make the first one when the shelf is empty", async ({ page, db }) => {
    db.seed("interactive_stories", []);
    await page.goto("/admin/stories");

    await expect(page.getByRole("heading", { name: /no stories yet/i })).toBeVisible();
    await page.getByRole("button", { name: /create story/i }).click();

    await expect(page).toHaveURL(/\/admin\/stories\/new$/);
  });

  test("shows a story with everything that describes it", async ({ page, db }) => {
    db.seed("interactive_stories", [
      anInteractiveStory({
        title: "The lost camel",
        title_arabic: "الجمل الضائع",
        description: "A traveller loses a camel in the desert.",
        dialect: "Egyptian",
        difficulty: "intermediate",
        status: "draft",
      }),
    ]);

    await page.goto("/admin/stories");

    await expect(page.getByText("The lost camel")).toBeVisible();
    await expect(page.getByText("الجمل الضائع")).toBeVisible();
    await expect(page.getByText("A traveller loses a camel in the desert.")).toBeVisible();
    // The admin bar carries an "Egyptian Arabic" switcher, so the badge has to
    // be matched exactly rather than by substring.
    await expect(page.getByText("Egyptian", { exact: true })).toBeVisible();
    await expect(page.getByText("intermediate")).toBeVisible();
    await expect(page.getByText("draft", { exact: true })).toBeVisible();
  });

  test("lists every dialect's stories together", async ({ page, db }) => {
    // Pinned, not fixed. Unlike every other admin list, this one does not filter
    // by the active dialect — the dialect is only a badge — so an admin working
    // on Gulf content sees the Egyptian and Yemeni shelves as well.
    db.seed("interactive_stories", [
      anInteractiveStory({ id: storyIdAt(0), title: "Gulf tale", dialect: "Gulf" }),
      anInteractiveStory({ id: storyIdAt(1), title: "Cairo tale", dialect: "Egyptian" }),
    ]);

    await page.goto("/admin/stories");

    await expect(page.getByText("Gulf tale")).toBeVisible();
    await expect(page.getByText("Cairo tale")).toBeVisible();
  });

  test("orders by the hand-set running order, not by date", async ({ page, db }) => {
    db.seed("interactive_stories", [
      anInteractiveStory({
        id: storyIdAt(0),
        title: "Second",
        display_order: 2,
        created_at: iso(),
      }),
      anInteractiveStory({
        id: storyIdAt(1),
        title: "First",
        display_order: 1,
        created_at: daysAgo(30),
      }),
    ]);

    await page.goto("/admin/stories");

    const titles = page.locator("h3.text-lg");
    await expect(titles.first()).toHaveText("First");
    await expect(titles.last()).toHaveText("Second");
  });

  test("publishes a draft from the list", async ({ page, db }) => {
    db.seed("interactive_stories", [anInteractiveStory({ id: STORY, status: "draft" })]);
    await page.goto("/admin/stories");

    await page.getByRole("button", { name: /^publish$/i }).click();

    await expect(page.getByText(/story published/i)).toBeVisible();
    expect(db.lastWriteTo("interactive_stories")).toMatchObject({ method: "PATCH" });
    expect(db.lastWriteTo("interactive_stories")?.payload[0]).toMatchObject({
      status: "published",
    });
    await expect(page.getByRole("button", { name: /^unpublish$/i })).toBeVisible();
  });

  test("takes a published story back down", async ({ page, db }) => {
    db.seed("interactive_stories", [anInteractiveStory({ id: STORY, status: "published" })]);
    await page.goto("/admin/stories");

    await page.getByRole("button", { name: /^unpublish$/i }).click();

    await expect(page.getByText(/story unpublished/i)).toBeVisible();
    expect(db.rows("interactive_stories")[0]).toMatchObject({ status: "draft" });
  });

  test("says so when the publish is rejected", async ({ page, db }) => {
    db.seed("interactive_stories", [anInteractiveStory({ id: STORY, status: "draft" })]);
    await page.goto("/admin/stories");

    db.failWrites("interactive_stories", 403);
    await page.getByRole("button", { name: /^publish$/i }).click();

    await expect(page.getByText(/failed to update status/i)).toBeVisible();
    expect(db.rows("interactive_stories")[0]).toMatchObject({ status: "draft" });
  });

  test("opens a story for editing", async ({ page, db }) => {
    db.seed("interactive_stories", [anInteractiveStory({ id: STORY })]);
    await page.goto("/admin/stories");

    await page.getByRole("button", { name: /^edit$/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/stories/${STORY}/edit$`));
  });

  test("asks before deleting, and warns about the scenes", async ({ page, db }) => {
    db.seed("interactive_stories", [anInteractiveStory({ id: STORY, title: "The lost camel" })]);
    let asked = "";
    page.on("dialog", (dialog) => {
      asked = dialog.message();
      return dialog.dismiss();
    });
    await page.goto("/admin/stories");

    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect.poll(() => asked).toContain("all its scenes");
    expect(db.writesTo("interactive_stories")).toHaveLength(0);
    await expect(page.getByText("The lost camel")).toBeVisible();
  });

  test("deletes once confirmed", async ({ page, db }) => {
    db.seed("interactive_stories", [anInteractiveStory({ id: STORY })]);
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/stories");

    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByText(/story deleted/i)).toBeVisible();
    expect(db.rows("interactive_stories")).toHaveLength(0);
    await expect(page.getByRole("heading", { name: /no stories yet/i })).toBeVisible();
  });

  test("reports a rejected delete instead of pretending it worked", async ({ page, db }) => {
    db.seed("interactive_stories", [anInteractiveStory({ id: STORY })]);
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/stories");

    db.failWrites("interactive_stories", 403);
    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByText(/failed to delete story/i)).toBeVisible();
    expect(db.rows("interactive_stories")).toHaveLength(1);
  });

  test("a content reviewer is turned away", async ({ page, signInAs, db }) => {
    await signInAs("content_reviewer");
    db.seed("interactive_stories", []);

    await page.goto("/admin/stories");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(/access denied/i)).toBeVisible();
  });

  test("a signed-in learner is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/admin/stories");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

test.describe("the reading library", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("offers to import the first text", async ({ page, db }) => {
    db.seed("authentic_stories", []);
    await page.goto("/admin/reading-library");

    await expect(page.getByRole("heading", { name: /no authentic stories yet/i })).toBeVisible();
    // The header carries the same control, so the empty state's own button is
    // the one to click here.
    await page.getByRole("main").getByRole("button", { name: /import story/i }).click();

    await expect(page).toHaveURL(/\/admin\/reading-library\/new$/);
  });

  test("shows a story with its provenance", async ({ page, db }) => {
    db.seed("authentic_stories", [
      anAuthenticStory({
        title: "Kalila and Dimna",
        title_arabic: "كليلة ودمنة",
        author: "Ibn al-Muqaffa",
        source_name: "folktale",
        dialect: "Egyptian",
        difficulty: "advanced",
        status: "content_approved",
      }),
    ]);

    await page.goto("/admin/reading-library");

    await expect(page.getByText("Kalila and Dimna")).toBeVisible();
    await expect(page.getByText("كليلة ودمنة")).toBeVisible();
    await expect(page.getByText("Ibn al-Muqaffa")).toBeVisible();
    await expect(page.getByText("folktale")).toBeVisible();
    await expect(page.getByText("advanced")).toBeVisible();
    await expect(page.getByText("content_approved")).toBeVisible();
  });

  test("labels a story with no dialect as MSA", async ({ page, db }) => {
    db.seed("authentic_stories", [anAuthenticStory({ dialect: "" })]);
    await page.goto("/admin/reading-library");

    await expect(page.getByText("MSA")).toBeVisible();
  });

  test("shows how far the audio has got", async ({ page, db }) => {
    db.seed("authentic_stories", [
      anAuthenticStory({ id: storyId(0), title: "Ready", video_status: "ready" }),
      anAuthenticStory({
        id: storyId(1),
        title: "Working",
        video_status: "generating",
        created_at: daysAgo(6),
      }),
      anAuthenticStory({
        id: storyId(2),
        title: "Broken",
        video_status: "failed",
        created_at: daysAgo(7),
      }),
    ]);

    await page.goto("/admin/reading-library");

    await expect(page.getByText("✅ Audio Ready")).toBeVisible();
    await expect(page.getByText("⏳ Generating")).toBeVisible();
    await expect(page.getByText("❌ Failed")).toBeVisible();
  });

  test("says nothing about audio that was never started", async ({ page, db }) => {
    db.seed("authentic_stories", [anAuthenticStory({ video_status: "none" })]);
    await page.goto("/admin/reading-library");

    await expect(page.getByText(/Audio Ready|Generating|Preview/)).toHaveCount(0);
  });

  test("shows the newest import first", async ({ page, db }) => {
    db.seed(
      "authentic_stories",
      many(anAuthenticStory, 3, (index) => ({
        id: storyId(index),
        title: `story ${index}`,
        created_at: daysAgo(index),
      })),
    );

    await page.goto("/admin/reading-library");

    const titles = page.locator("h3.text-lg");
    await expect(titles.first()).toHaveText("story 0");
    await expect(titles.last()).toHaveText("story 2");
  });

  test("opens a story for editing", async ({ page, db }) => {
    db.seed("authentic_stories", [anAuthenticStory({ id: storyId(0) })]);
    await page.goto("/admin/reading-library");

    await page.getByRole("button", { name: /^edit$/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/reading-library/${storyId(0)}/edit$`));
  });

  test("offers no way to publish from the list", async ({ page, db }) => {
    // Pinned, not fixed. The interactive shelf publishes in place; this one
    // shows the status as a badge and gives no control to change it, so
    // approving a text means opening its editor.
    db.seed("authentic_stories", [anAuthenticStory({ status: "draft" })]);
    await page.goto("/admin/reading-library");

    await expect(page.getByText("draft", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /publish/i })).toHaveCount(0);
  });

  test("asks before deleting", async ({ page, db }) => {
    db.seed("authentic_stories", [anAuthenticStory({ id: storyId(0), title: "Kalila" })]);
    page.on("dialog", (dialog) => dialog.dismiss());
    await page.goto("/admin/reading-library");

    await page.locator("button:has(svg.lucide-trash2)").click();

    expect(db.writesTo("authentic_stories")).toHaveLength(0);
    await expect(page.getByText("Kalila")).toBeVisible();
  });

  test("deletes once confirmed", async ({ page, db }) => {
    db.seed("authentic_stories", [anAuthenticStory({ id: storyId(0) })]);
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/reading-library");

    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByText(/story deleted/i)).toBeVisible();
    expect(db.rows("authentic_stories")).toHaveLength(0);
  });

  test("reports a rejected delete", async ({ page, db }) => {
    db.seed("authentic_stories", [anAuthenticStory({ id: storyId(0) })]);
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/reading-library");

    db.failWrites("authentic_stories", 403);
    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByText(/failed to delete story/i)).toBeVisible();
    expect(db.rows("authentic_stories")).toHaveLength(1);
  });
});

test.describe("suggesting a story to import", () => {
  const suggestion = {
    title: "The Generous Host",
    title_arabic: "المضيف الكريم",
    description: "A folktale about hospitality.",
    description_arabic: "حكاية عن الكرم.",
    source_type: "cultural_narrative",
    estimated_length: "medium",
    themes: ["generosity", "wisdom"],
  };

  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("authentic_stories", []);
  });

  async function openSuggestions(page: import("@playwright/test").Page) {
    await page.goto("/admin/reading-library");
    await page.getByRole("button", { name: /suggest stories/i }).click();
    await expect(page.getByRole("heading", { name: /ai story suggestions/i })).toBeVisible();
  }

  test("asks with the chosen dialect and level", async ({ page, backend }) => {
    backend.stubFunction("suggest-stories", { suggestions: [suggestion] });
    await openSuggestions(page);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Egyptian" }).click();
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "advanced" }).click();
    await page.getByRole("button", { name: /find stories/i }).click();

    await expect(page.getByText("The Generous Host")).toBeVisible();
    expect(backend.lastCallTo("suggest-stories")?.body).toMatchObject({
      dialect: "Egyptian",
      difficulty: "advanced",
    });
  });

  test("shows each suggestion with its themes", async ({ page, backend }) => {
    backend.stubFunction("suggest-stories", { suggestions: [suggestion] });
    await openSuggestions(page);
    await page.getByRole("button", { name: /find stories/i }).click();

    await expect(page.getByText("المضيف الكريم")).toBeVisible();
    await expect(page.getByText("A folktale about hospitality.")).toBeVisible();
    // The underscore in the source type is spaced out for display.
    await expect(page.getByText("cultural narrative")).toBeVisible();
    await expect(page.getByText("generosity")).toBeVisible();
    await expect(page.getByText("medium")).toBeVisible();
  });

  test("offers to ask again once it has answered", async ({ page, backend }) => {
    backend.stubFunction("suggest-stories", { suggestions: [suggestion] });
    await openSuggestions(page);
    await page.getByRole("button", { name: /find stories/i }).click();

    await expect(page.getByRole("button", { name: /get new suggestions/i })).toBeVisible();
  });

  test("says so when the model returned nothing usable", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunction("suggest-stories", { notSuggestions: true });
    await openSuggestions(page);

    await page.getByRole("button", { name: /find stories/i }).click();

    await expect(page.getByText(/no suggestions returned/i)).toBeVisible();
  });

  test("reports a failed suggestion call", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("suggest-stories", 500);
    await openSuggestions(page);

    await page.getByRole("button", { name: /find stories/i }).click();

    await expect(page.getByText(/non-2xx status code/i)).toBeVisible();
  });

  test("writes, imports and opens the story in one tap", async ({ page, backend }) => {
    backend.stubFunction("suggest-stories", { suggestions: [suggestion] });
    backend.stubFunction("generate-suggested-story-text", {
      body_arabic: "كان يا ما كان",
      author: "Traditional",
      author_arabic: "تراثي",
    });
    backend.stubFunction("import-authentic-story", {
      story: { id: storyId(3), title: "The Generous Host" },
    });

    await openSuggestions(page);
    await page.getByRole("button", { name: /find stories/i }).click();
    await page.getByText("The Generous Host").click();

    await expect(page).toHaveURL(new RegExp(`/admin/reading-library/${storyId(3)}/edit$`));

    // The suggestion is expanded into full text before the import — that step
    // is the whole reason the flow exists.
    expect(backend.lastCallTo("generate-suggested-story-text")?.body).toMatchObject({
      title: "The Generous Host",
      title_arabic: "المضيف الكريم",
      estimated_length: "medium",
      themes: ["generosity", "wisdom"],
    });
    expect(backend.lastCallTo("import-authentic-story")?.body).toMatchObject({
      title: "The Generous Host",
      author: "Traditional",
      body_arabic: "كان يا ما كان",
      license: "public_domain",
      source_name: "cultural narrative",
    });
  });

  test("stays put when the story text cannot be written", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunction("suggest-stories", { suggestions: [suggestion] });
    backend.stubFunctionFailure("generate-suggested-story-text", 500);

    await openSuggestions(page);
    await page.getByRole("button", { name: /find stories/i }).click();
    await page.getByText("The Generous Host").click();

    await expect(page.getByText(/non-2xx status code/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/reading-library$/);
    expect(backend.callsTo("import-authentic-story")).toHaveLength(0);
  });

  test("says so when the import comes back without an id", async ({ page, backend }) => {
    // The three-step chain has no transaction, so this is the one failure the
    // page can only describe rather than undo.
    backend.stubFunction("suggest-stories", { suggestions: [suggestion] });
    backend.stubFunction("generate-suggested-story-text", { body_arabic: "نص" });
    backend.stubFunction("import-authentic-story", { story: null });

    await openSuggestions(page);
    await page.getByRole("button", { name: /find stories/i }).click();
    await page.getByText("The Generous Host").click();

    await expect(page.getByText(/no ID was returned/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/reading-library$/);
  });

  test("forgets the suggestions when the dialog is closed", async ({ page, backend }) => {
    backend.stubFunction("suggest-stories", { suggestions: [suggestion] });
    await openSuggestions(page);
    await page.getByRole("button", { name: /find stories/i }).click();
    await expect(page.getByText("The Generous Host")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /suggest stories/i }).click();

    await expect(page.getByText("The Generous Host")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /find stories/i })).toBeVisible();
  });
});
