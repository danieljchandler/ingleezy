import { expect, test } from "./support/fixtures";
import {
  anInteractiveStory,
  aStoryScene,
  sceneId,
  interactiveStoryId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * The interactive-story editor: a branching story authored scene by scene.
 *
 * Two things make this worth exhaustive coverage. The save is destructive — an
 * edit deletes every existing scene and re-inserts the form's, so a save that
 * fails halfway takes the story's content with it. And the branching is by
 * position: a choice points at a sibling's `scene_order`, not its id, so
 * removing a scene renumbers the ones after it and silently redirects every
 * choice that pointed past the gap.
 *
 * The AI generator overwrites the whole form rather than appending, which is
 * the behaviour anyone who has typed a scene by hand first would want to know
 * about.
 */

const STORY = interactiveStoryId(0);

const sceneCards = (page: Page) => page.locator("div.border-l-4");
const titleField = (page: Page) => page.getByPlaceholder("At the Coffee Shop");
const arabicTitleField = (page: Page) => page.getByPlaceholder("في المقهى");
const saveButton = (page: Page) => page.getByRole("button", { name: "Save Story" });

/** A saved story with `sceneCount` scenes already on it. */
function seedStory(db: MemoryDb, sceneCount = 2, over: Record<string, unknown> = {}) {
  db.seed("interactive_stories", [
    anInteractiveStory({
      id: STORY,
      title: "At the Coffee Shop",
      title_arabic: "في المقهى",
      description: "Practice ordering",
      description_arabic: "تدرب على الطلب",
      dialect: "Gulf",
      difficulty: "Beginner",
      ...over,
    }),
  ]);
  db.seed(
    "story_scenes",
    Array.from({ length: sceneCount }, (_, index) =>
      aStoryScene({
        id: sceneId(index),
        story_id: STORY,
        scene_order: index,
        narrative_arabic: `مشهد ${index}`,
        narrative_english: `Scene ${index} narrative`,
        is_ending: index === sceneCount - 1,
        ending_message: index === sceneCount - 1 ? "Well done" : null,
        ending_message_arabic: index === sceneCount - 1 ? "أحسنت" : null,
        choices: index === sceneCount - 1 ? [] : [
          { text_arabic: "اطلب قهوة", text_english: "Order coffee", next_scene_order: index + 1 },
        ],
      }),
    ),
  );
}

/** Wait for a write to land, then return its payload. */
async function writtenTo(db: MemoryDb, table: string): Promise<Record<string, unknown>[]> {
  await expect.poll(() => db.writesTo(table).length).toBeGreaterThan(0);
  return db.lastWriteTo(table)!.payload as Record<string, unknown>[];
}

const aGeneratedStory = (over: Record<string, unknown> = {}) => ({
  story: {
    title: "Bargaining at the souq",
    title_arabic: "المساومة في السوق",
    description: "Haggle for spices",
    description_arabic: "ساوم على البهارات",
    scenes: [
      {
        scene_order: 0,
        narrative_arabic: "دخلت السوق",
        narrative_english: "You entered the souq",
        narrative_literal: "entered-I the-souq",
        vocabulary: [{ word_arabic: "سوق", word_english: "souq" }],
        choices: [{ text_arabic: "اسأل عن السعر", text_english: "Ask the price", next_scene_order: 1 }],
        is_ending: false,
      },
      {
        scene_order: 1,
        narrative_arabic: "اشتريت البهارات",
        narrative_english: "You bought the spices",
        vocabulary: [],
        choices: [],
        is_ending: true,
        ending_message: "You got a good price",
        ending_message_arabic: "حصلت على سعر جيد",
      },
    ],
    ...over,
  },
});

test.beforeEach(async ({ signInAs }) => {
  await signInAs("admin");
});

test.describe("a new story", () => {
  test("opens with one empty scene", async ({ page }) => {
    await page.goto("/admin/stories/new");

    await expect(page.getByRole("heading", { name: "New Story" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Scenes (1)" })).toBeVisible();
    await expect(titleField(page)).toHaveValue("");
  });

  test("will not save without a title", async ({ page, db }) => {
    await page.goto("/admin/stories/new");
    await saveButton(page).click();

    await expect(page.getByText("Title is required")).toBeVisible();
    expect(db.lastWriteTo("interactive_stories")).toBeUndefined();
  });

  test("saves the story details as entered", async ({ page, db }) => {
    await page.goto("/admin/stories/new");
    await titleField(page).fill("At the Coffee Shop");
    await arabicTitleField(page).fill("في المقهى");
    await page.getByPlaceholder("Practice ordering at a Gulf coffee shop").fill("Order a coffee");
    await page.getByPlaceholder("تدرب على الطلب في مقهى خليجي").fill("اطلب قهوة");
    await saveButton(page).click();

    const written = (await writtenTo(db, "interactive_stories"))[0];
    expect(written).toMatchObject({
      title: "At the Coffee Shop",
      title_arabic: "في المقهى",
      description: "Order a coffee",
      description_arabic: "اطلب قهوة",
      dialect: "Gulf",
      difficulty: "Beginner",
    });
    // Authorship is what RLS scopes an edit to.
    expect(written.created_by).toBeTruthy();
  });

  test("records the chosen dialect and difficulty", async ({ page, db }) => {
    await page.goto("/admin/stories/new");
    await titleField(page).fill("At the market");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Egyptian" }).click();
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Advanced" }).click();
    await saveButton(page).click();

    expect((await writtenTo(db, "interactive_stories"))[0]).toMatchObject({
      dialect: "Egyptian",
      difficulty: "Advanced",
    });
  });

  test("saves the scene alongside the story", async ({ page, db }) => {
    await page.goto("/admin/stories/new");
    await titleField(page).fill("At the Coffee Shop");
    await page.getByPlaceholder("دخلت المقهى وشفت...").fill("دخلت المقهى");
    await page.getByPlaceholder("You entered the café and saw...").fill("You entered the café");
    await page.getByPlaceholder("entered-I the-café and-saw-I...").fill("entered-I the-café");
    await saveButton(page).click();

    const scenes = await writtenTo(db, "story_scenes");
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({
      scene_order: 0,
      narrative_arabic: "دخلت المقهى",
      narrative_english: "You entered the café",
      narrative_literal: "entered-I the-café",
      is_ending: false,
    });
  });

  test("goes back to the story list once saved", async ({ page }) => {
    await page.goto("/admin/stories/new");
    await titleField(page).fill("At the Coffee Shop");
    await saveButton(page).click();

    await expect(page.getByText("Story created!")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/stories$/);
  });

  test("says so when the story cannot be saved", async ({ page, db }) => {
    db.failWrites("interactive_stories", 403, { message: "new row violates row-level security policy" });

    await page.goto("/admin/stories/new");
    await titleField(page).fill("At the Coffee Shop");
    await saveButton(page).click();

    await expect(page.getByText(/row-level security/)).toBeVisible();
    // Still on the form, so nothing typed is lost.
    await expect(page).toHaveURL(/\/admin\/stories\/new$/);
  });

  test("leaves a story with no scenes when the scene write fails", async ({ page, db }) => {
    db.failWrites("story_scenes", 400, { message: "value too long for type character varying" });

    await page.goto("/admin/stories/new");
    await titleField(page).fill("At the Coffee Shop");
    await saveButton(page).click();

    // Pinned. The story row and its scenes are two writes, not a transaction —
    // a rejected scene insert leaves a titled story with nothing in it, and the
    // reader renders that as a story that ends immediately.
    await expect(page.getByText(/value too long/)).toBeVisible();
    expect(db.lastWriteTo("interactive_stories")).toBeTruthy();
  });
});

test.describe("editing an existing story", () => {
  test("loads the story's details into the form", async ({ page, db }) => {
    seedStory(db);

    await page.goto(`/admin/stories/${STORY}/edit`);

    await expect(page.getByRole("heading", { name: "Edit Story" })).toBeVisible();
    await expect(titleField(page)).toHaveValue("At the Coffee Shop");
    await expect(arabicTitleField(page)).toHaveValue("في المقهى");
  });

  test("loads every scene in order", async ({ page, db }) => {
    seedStory(db, 3);

    await page.goto(`/admin/stories/${STORY}/edit`);

    await expect(page.getByRole("heading", { name: "Scenes (3)" })).toBeVisible();
    await expect(sceneCards(page)).toHaveCount(3);
    await expect(page.getByPlaceholder("You entered the café and saw...").first()).toHaveValue(
      "Scene 0 narrative",
    );
  });

  test("marks an ending scene as one", async ({ page, db }) => {
    seedStory(db, 2);

    await page.goto(`/admin/stories/${STORY}/edit`);

    // The badge, not the switch's label or the message fields.
    await expect(page.getByText("Ending", { exact: true })).toBeVisible();
    // An ending has a farewell instead of choices — the two are exclusive in
    // the editor as well as in the reader.
    await expect(page.getByPlaceholder("Congratulations! You ordered successfully.")).toHaveValue("Well done");
  });

  test("updates rather than duplicating the story", async ({ page, db }) => {
    seedStory(db);

    await page.goto(`/admin/stories/${STORY}/edit`);
    // Wait for the form to hydrate from the fetched story before typing over
    // it. Filling first is a race the test loses on a slower machine: the load
    // lands afterwards and puts the stored title back, and the save then PATCHes
    // the old one.
    await expect(titleField(page)).toHaveValue("At the Coffee Shop");
    await titleField(page).fill("At the Tea House");
    await saveButton(page).click();

    await expect(page.getByText("Story updated!")).toBeVisible();
    const write = db.writesTo("interactive_stories").at(-1);
    expect(write?.method).toBe("PATCH");
    expect(write?.payload[0]).toMatchObject({ title: "At the Tea House" });
  });

  test("replaces every scene rather than merging them", async ({ page, db }) => {
    seedStory(db, 2);

    await page.goto(`/admin/stories/${STORY}/edit`);
    await expect(sceneCards(page)).toHaveCount(2);
    await saveButton(page).click();
    await expect(page.getByText("Story updated!")).toBeVisible();

    // Pinned as the design, and as its risk: the save deletes all scenes and
    // re-inserts the form's. Every scene gets a new id on every save, so
    // anything referencing a scene by id — a bookmark, an analytics row — is
    // broken by an unrelated typo fix. And a delete that succeeds followed by
    // an insert that fails leaves the story empty.
    const deletes = db.writesTo("story_scenes").filter((w) => w.method === "DELETE");
    expect(deletes).toHaveLength(1);
    const inserted = db.writesTo("story_scenes").filter((w) => w.method === "POST").at(-1);
    expect(inserted?.payload).toHaveLength(2);
  });

  test("empties a story when the re-insert fails after the delete", async ({ page, db }) => {
    seedStory(db, 2);

    await page.goto(`/admin/stories/${STORY}/edit`);
    await expect(sceneCards(page)).toHaveCount(2);
    db.failInserts("story_scenes", 400, { message: "insert rejected" });
    await saveButton(page).click();

    // Pinned. The delete is not conditioned on the insert succeeding, so this
    // is a save that destroys the story's content and reports an error.
    await expect(page.getByText(/insert rejected/)).toBeVisible();
    expect(db.rows("story_scenes")).toHaveLength(0);
  });
});

test.describe("building the branches", () => {
  test("adds and removes a scene", async ({ page, db }) => {
    seedStory(db, 2);

    await page.goto(`/admin/stories/${STORY}/edit`);
    await page.getByRole("button", { name: "Add Scene" }).click();
    await expect(page.getByRole("heading", { name: "Scenes (3)" })).toBeVisible();

    await sceneCards(page).nth(2).locator("button:has(svg.lucide-trash2)").first().click();
    await expect(page.getByRole("heading", { name: "Scenes (2)" })).toBeVisible();
  });

  test("will not let the last scene be removed", async ({ page }) => {
    await page.goto("/admin/stories/new");

    // A story with no scenes has nothing to render; the control is disabled
    // rather than allowed and then rejected on save.
    await expect(
      sceneCards(page).first().locator("button:has(svg.lucide-trash2)").first(),
    ).toBeDisabled();
  });

  test("renumbers the scenes after one is deleted", async ({ page, db }) => {
    seedStory(db, 3);

    await page.goto(`/admin/stories/${STORY}/edit`);
    await sceneCards(page).nth(0).locator("button:has(svg.lucide-trash2)").first().click();
    await saveButton(page).click();

    const scenes = (await writtenTo(db, "story_scenes")).filter((s) => "scene_order" in s);
    expect(scenes.map((s) => s.scene_order)).toEqual([0, 1]);
  });

  test("leaves choices pointing at the old numbering after a delete", async ({ page, db }) => {
    seedStory(db, 3);

    await page.goto(`/admin/stories/${STORY}/edit`);
    // Scene 0's choice points at scene 1; scene 1's points at scene 2.
    await sceneCards(page).nth(0).locator("button:has(svg.lucide-trash2)").first().click();
    await saveButton(page).click();

    // Pinned, not fixed. Deleting a scene renumbers the survivors but leaves
    // every `next_scene_order` untouched, so what was scene 1 → 2 is now scene
    // 0 → 2 and there is no scene 2 any more. The reader hits a dead end and
    // the editor gives no warning — the numbers are only visible one scene at a
    // time, in a small numeric input.
    const scenes = await writtenTo(db, "story_scenes");
    const firstChoices = scenes[0].choices as Array<{ next_scene_order: number }>;
    expect(firstChoices[0].next_scene_order).toBe(2);
    expect(scenes).toHaveLength(2);
  });

  test("adds a choice with its two languages and its target", async ({ page, db }) => {
    await page.goto("/admin/stories/new");
    await titleField(page).fill("At the Coffee Shop");
    await page.getByRole("button", { name: "Add Choice" }).click();
    await page.getByPlaceholder("Arabic text").fill("اطلب قهوة");
    await page.getByPlaceholder("English text").fill("Order coffee");
    await page.locator('input[type="number"]').fill("2");
    await saveButton(page).click();

    const scenes = await writtenTo(db, "story_scenes");
    expect(scenes[0].choices).toEqual([
      { text_arabic: "اطلب قهوة", text_english: "Order coffee", next_scene_order: 2 },
    ]);
  });

  test("says when a scene has no choices yet", async ({ page }) => {
    await page.goto("/admin/stories/new");

    await expect(page.getByText("No choices yet. Add choices to branch the story.")).toBeVisible();
  });

  test("removes a choice", async ({ page, db }) => {
    seedStory(db, 2);

    await page.goto(`/admin/stories/${STORY}/edit`);
    await expect(page.getByPlaceholder("Arabic text")).toHaveCount(1);
    await sceneCards(page).nth(0).locator("div.bg-muted\\/50 button").click();
    await expect(page.getByPlaceholder("Arabic text")).toHaveCount(0);
  });

  test("hides the choices once a scene becomes an ending", async ({ page, db }) => {
    seedStory(db, 2);

    await page.goto(`/admin/stories/${STORY}/edit`);
    await expect(page.getByPlaceholder("Arabic text")).toHaveCount(1);
    await page.getByRole("switch").first().click();

    // Choices and an ending message are mutually exclusive.
    await expect(page.getByPlaceholder("Arabic text")).toHaveCount(0);
    await expect(page.getByPlaceholder("Congratulations! You ordered successfully.")).toHaveCount(2);
  });

  test("keeps the choices in the row when an ending is toggled back", async ({ page, db }) => {
    seedStory(db, 2);

    await page.goto(`/admin/stories/${STORY}/edit`);
    await page.getByRole("switch").first().click();
    await page.getByRole("switch").first().click();
    await saveButton(page).click();

    // The choice was only hidden, not discarded — toggling by accident must not
    // lose work.
    const scenes = await writtenTo(db, "story_scenes");
    expect((scenes[0].choices as unknown[]).length).toBe(1);
  });

  test("saves an ending message on both sides", async ({ page, db }) => {
    await page.goto("/admin/stories/new");
    await titleField(page).fill("At the Coffee Shop");
    await page.getByRole("switch").click();
    await page.getByPlaceholder("Congratulations! You ordered successfully.").fill("Well done");
    await page.getByPlaceholder("مبروك! طلبت بنجاح").fill("أحسنت");
    await saveButton(page).click();

    expect((await writtenTo(db, "story_scenes"))[0]).toMatchObject({
      is_ending: true,
      ending_message: "Well done",
      ending_message_arabic: "أحسنت",
    });
  });
});

test.describe("scene vocabulary", () => {
  test("adds a word pair to a scene", async ({ page, db }) => {
    await page.goto("/admin/stories/new");
    await titleField(page).fill("At the Coffee Shop");
    await page.getByRole("button", { name: "Add Word" }).click();
    await page.getByPlaceholder("عربي").fill("مقهى");
    await page.getByPlaceholder("English", { exact: true }).fill("café");
    await saveButton(page).click();

    expect((await writtenTo(db, "story_scenes"))[0].vocabulary).toEqual([
      { word_arabic: "مقهى", word_english: "café" },
    ]);
  });

  test("removes a word pair", async ({ page, db }) => {
    seedStory(db, 2);

    await page.goto(`/admin/stories/${STORY}/edit`);
    await expect(page.getByPlaceholder("عربي")).toHaveCount(2);
    await sceneCards(page).nth(0).locator("div.rounded-full button").click();
    await expect(page.getByPlaceholder("عربي")).toHaveCount(1);
  });
});

test.describe("generating a story with AI", () => {
  test("will not generate without a topic", async ({ page }) => {
    await page.goto("/admin/stories/new");
    await page.getByRole("button", { name: "Generate with AI" }).click();

    // The topic is the whole request; a blank one would have the model invent a
    // story with no relation to what the admin wanted.
    await expect(page.getByRole("button", { name: "Generate Story" })).toBeDisabled();
  });

  test("sends the topic, dialect, difficulty and scene count", async ({ page, backend }) => {
    await page.goto("/admin/stories/new");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Egyptian" }).click();
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await page.getByLabel("Story Topic / Scenario *").fill("Negotiating a taxi fare in Cairo");
    await page.getByLabel("Additional Guidance (optional)").fill("Include numbers");
    backend.stubFunction("generate-story", aGeneratedStory());
    await page.getByRole("button", { name: "Generate Story" }).click();

    await expect(page.getByText("Story generated!")).toBeVisible();
    expect(backend.lastCallTo("generate-story")?.body).toMatchObject({
      prompt: "Negotiating a taxi fare in Cairo",
      guidance: "Include numbers",
      dialect: "Egyptian",
      difficulty: "Beginner",
      sceneCount: 5,
    });
  });

  test("omits guidance that was left blank", async ({ page, backend }) => {
    backend.stubFunction("generate-story", aGeneratedStory());

    await page.goto("/admin/stories/new");
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await page.getByLabel("Story Topic / Scenario *").fill("Ordering at a restaurant");
    await page.getByRole("button", { name: "Generate Story" }).click();
    await expect(page.getByText("Story generated!")).toBeVisible();

    // Sent as undefined rather than an empty string, so the prompt does not
    // carry an empty "Additional guidance:" heading.
    expect(backend.lastCallTo("generate-story")?.body).not.toHaveProperty("guidance");
  });

  test("fills the whole form from what came back", async ({ page, backend }) => {
    backend.stubFunction("generate-story", aGeneratedStory());

    await page.goto("/admin/stories/new");
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await page.getByLabel("Story Topic / Scenario *").fill("Bargaining at the souq");
    await page.getByRole("button", { name: "Generate Story" }).click();

    await expect(titleField(page)).toHaveValue("Bargaining at the souq");
    await expect(arabicTitleField(page)).toHaveValue("المساومة في السوق");
    await expect(page.getByRole("heading", { name: "Scenes (2)" })).toBeVisible();
    await expect(page.getByPlaceholder("دخلت المقهى وشفت...").first()).toHaveValue("دخلت السوق");
  });

  test("discards hand-written scenes rather than adding to them", async ({ page, backend }) => {
    backend.stubFunction("generate-story", aGeneratedStory());

    await page.goto("/admin/stories/new");
    await page.getByPlaceholder("You entered the café and saw...").fill("Something I typed myself");
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await page.getByLabel("Story Topic / Scenario *").fill("Bargaining at the souq");
    await page.getByRole("button", { name: "Generate Story" }).click();
    await expect(page.getByText("Story generated!")).toBeVisible();

    // Pinned. Generation replaces the scene list outright, with no confirmation
    // and no undo — an admin who drafted a scene and then reached for the AI
    // loses it. The toast says "Review and edit before saving", which reads as
    // though nothing has been lost.
    await expect(page.getByText("Something I typed myself")).toHaveCount(0);
  });

  test("saves nothing by itself", async ({ page, backend, db }) => {
    backend.stubFunction("generate-story", aGeneratedStory());

    await page.goto("/admin/stories/new");
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await page.getByLabel("Story Topic / Scenario *").fill("Bargaining at the souq");
    await page.getByRole("button", { name: "Generate Story" }).click();
    await expect(page.getByText("Story generated!")).toBeVisible();

    // Generation fills the form; the admin still has to press Save. That is the
    // review step, and it only means anything if nothing was written first.
    expect(db.lastWriteTo("interactive_stories")).toBeUndefined();
    expect(db.lastWriteTo("story_scenes")).toBeUndefined();
  });

  test("says so when the generator fails", async ({ page, backend }) => {
    backend.stubFunctionFailure("generate-story", 500, { error: "model unavailable" });

    await page.goto("/admin/stories/new");
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await page.getByLabel("Story Topic / Scenario *").fill("Bargaining at the souq");
    await page.getByRole("button", { name: "Generate Story" }).click();

    // The dialog stays open so the topic can be retried without retyping.
    await expect(page.getByRole("heading", { name: "Generate Story with AI" })).toBeVisible();
  });

  test("says so when the generator answers with no story", async ({ page, backend }) => {
    backend.stubFunction("generate-story", { ok: true });

    await page.goto("/admin/stories/new");
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await page.getByLabel("Story Topic / Scenario *").fill("Bargaining at the souq");
    await page.getByRole("button", { name: "Generate Story" }).click();

    await expect(page.getByText("No story returned from AI")).toBeVisible();
  });

  test("closes without touching the form on Cancel", async ({ page }) => {
    await page.goto("/admin/stories/new");
    await titleField(page).fill("Typed by hand");
    await page.getByRole("button", { name: "Generate with AI" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("heading", { name: "Generate Story with AI" })).toHaveCount(0);
    await expect(titleField(page)).toHaveValue("Typed by hand");
  });
});

test.describe("getting in", () => {
  test("turns a plain learner away", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/admin/stories/new");

    await expect(page.getByRole("heading", { name: "New Story" })).toHaveCount(0);
  });

  test("turns a content reviewer away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");

    await page.goto("/admin/stories/new");

    await expect(page.getByRole("heading", { name: "New Story" })).toHaveCount(0);
  });
});
