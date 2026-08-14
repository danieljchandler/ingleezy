import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * Interactive stories — branching ENGLISH narratives with a saved position.
 *
 * The scene graph is data, not code: each scene carries `choices`, and each
 * choice names the `scene_order` it leads to. Nothing validates that the target
 * exists, so a story authored with a typo is a broken link that only shows up
 * when a reader takes that branch. The player has a branch for it, and this
 * spec exercises it, because an editor cannot see it from the admin form.
 *
 * Progress is an upsert keyed on (user_id, story_id) holding the whole path
 * taken, so resuming is replaying a list of scene orders rather than a pointer.
 * That makes "where was I" and "how did I get here" the same record — and makes
 * a lost write cost the reader the whole run, not one step.
 */

const STORY = "bbbbbbbb-0000-4000-8000-000000000000";

const aStory = (over: Record<string, unknown> = {}) => ({
  id: STORY,
  title: "Lost in the market",
  title_arabic: "ضايع في السوق",
  description: "Find your way back to the hotel",
  description_arabic: "",
  dialect: "Gulf",
  difficulty: "Beginner",
  icon_name: "map",
  cover_image_url: null,
  session_id: null,
  status: "published",
  display_order: 1,
  created_by: TEST_USER_ID,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

const aScene = (order: number, over: Record<string, unknown> = {}) => ({
  id: `cccccccc-0000-4000-8000-00000000000${order}`,
  story_id: STORY,
  scene_order: order,
  narrative_english: `Scene number ${order}`,
  narrative_arabic: `المشهد رقم ${order}`,
  narrative_literal: null,
  vocabulary: [],
  choices: [],
  is_ending: false,
  ending_message: null,
  ending_message_arabic: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

/** A three-scene story: an opening that forks into two endings. */
function seedForkedStory(db: MemoryDb) {
  db.seed("interactive_stories", [aStory()]);
  db.seed("story_scenes", [
    aScene(0, {
      narrative_english: "You are in the market",
      narrative_arabic: "أنت في السوق",
      choices: [
        { text_english: "Ask the shopkeeper", text_arabic: "اسأل البائع", next_scene_order: 1 },
        { text_english: "Walk on alone", text_arabic: "امش لوحدك", next_scene_order: 2 },
      ],
    }),
    aScene(1, {
      narrative_english: "The shopkeeper points the way",
      narrative_arabic: "البائع يدلك على الطريق",
      is_ending: true,
      ending_message: "You found the hotel",
      ending_message_arabic: "وصلت الفندق",
    }),
    aScene(2, {
      narrative_english: "You are more lost than before",
      narrative_arabic: "ضعت أكثر",
      is_ending: true,
      ending_message: "Try asking next time",
    }),
  ]);
  db.seed("story_progress", []);
}

test.describe("the story list", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("lists a published story with its dialect and difficulty", async ({ page, db }) => {
    db.seed("interactive_stories", [aStory()]);

    await page.goto("/stories");

    await expect(page.getByRole("heading", { name: "Lost in the market" })).toBeVisible();
    await expect(page.getByText("Gulf")).toBeVisible();
    await expect(page.getByText("Beginner")).toBeVisible();
  });

  test("hides a draft", async ({ page, db }) => {
    db.seed("interactive_stories", [
      aStory({ title: "Ready to read" }),
      aStory({ id: `${STORY.slice(0, -1)}1`, title: "Still being written", status: "draft" }),
    ]);

    await page.goto("/stories");

    await expect(page.getByRole("heading", { name: "Ready to read" })).toBeVisible();
    await expect(page.getByText("Still being written")).toHaveCount(0);
  });

  test("orders stories the way the editor arranged them", async ({ page, db }) => {
    db.seed("interactive_stories", [
      aStory({ id: `${STORY.slice(0, -1)}1`, title: "Second", display_order: 2 }),
      aStory({ title: "First", display_order: 1 }),
    ]);

    await page.goto("/stories");

    await expect(page.getByRole("heading", { level: 3 }).first()).toHaveText("First");
  });

  test("lists stories from every dialect, not just the active one", async ({ page, db }) => {
    db.seed("interactive_stories", [
      aStory({ title: "Gulf story", dialect: "Gulf" }),
      aStory({ id: `${STORY.slice(0, -1)}1`, title: "Egyptian story", dialect: "Egyptian" }),
    ]);

    await page.goto("/stories");

    // Deliberate, and different from how the curriculum behaves:
    // the query has no dialect filter, and the card badges the dialect instead.
    // The dialect only changes the scaffold language here — the English is the
    // same task for everyone — so cross-dialect browsing costs nothing.
    await expect(page.getByRole("heading", { name: "Gulf story" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Egyptian story" })).toBeVisible();
  });

  test("says so when nothing is published", async ({ page, db }) => {
    db.seed("interactive_stories", []);

    await page.goto("/stories");

    await expect(page.getByText(/ما فيه قصص بعد/i)).toBeVisible();
  });

  test("opens a story from the list", async ({ page, db }) => {
    seedForkedStory(db);

    await page.goto("/stories");
    await page.getByRole("heading", { name: "Lost in the market" }).click();

    await expect(page).toHaveURL(new RegExp(`/stories/${STORY}$`));
  });

  test("is readable without an account", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    db.seed("interactive_stories", [aStory()]);

    // No ProtectedRoute on either story route — this is a sample-the-product
    // surface, and a redirect to /auth would defeat that.
    await page.goto("/stories");

    await expect(page.getByRole("heading", { name: "Lost in the market" })).toBeVisible();
  });
});

test.describe("playing through a story", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedForkedStory(db);
  });

  test("opens on the first scene with its choices", async ({ page }) => {
    await page.goto(`/stories/${STORY}`);

    await expect(page.getByText("You are in the market")).toBeVisible();
    await expect(page.getByText("Ask the shopkeeper")).toBeVisible();
    await expect(page.getByText("Walk on alone")).toBeVisible();
  });

  test("counts the scene against the story's length", async ({ page }) => {
    await page.goto(`/stories/${STORY}`);

    await expect(page.getByText("المشهد 1 · 3 مشاهد بالكل")).toBeVisible();
  });

  test("follows the branch the reader picks", async ({ page }) => {
    await page.goto(`/stories/${STORY}`);
    await page.getByText("Walk on alone").click();

    // Both choices lead to an ending, so picking the wrong one has to land
    // somewhere different rather than somewhere generic.
    await expect(page.getByText("You are more lost than before")).toBeVisible();
    await expect(page.getByText("Try asking next time")).toBeVisible();
    await expect(page.getByText("The shopkeeper points the way")).toHaveCount(0);
  });

  test("records the whole path taken, not just where the reader stopped", async ({ page, db }) => {
    await page.goto(`/stories/${STORY}`);
    await page.getByText("Ask the shopkeeper").click();
    await expect(page.getByText("خلصت القصة!")).toBeVisible();

    await expect.poll(() => db.rows("story_progress").length).toBe(1);
    expect(db.rows("story_progress")[0]).toMatchObject({
      user_id: TEST_USER_ID,
      story_id: STORY,
      path_taken: [0, 1],
      completed: true,
    });
  });

  test("celebrates an ending instead of asking for another choice", async ({ page }) => {
    await page.goto(`/stories/${STORY}`);
    await page.getByText("Ask the shopkeeper").click();

    await expect(page.getByText("خلصت القصة!")).toBeVisible();
    await expect(page.getByText("You found the hotel")).toBeVisible();
    await expect(page.getByText("وصلت الفندق")).toBeVisible();
    await expect(page.getByText("What do you do?")).toHaveCount(0);
  });

  test("starts over from the ending", async ({ page, db }) => {
    await page.goto(`/stories/${STORY}`);
    await page.getByText("Ask the shopkeeper").click();
    await expect(page.getByText("خلصت القصة!")).toBeVisible();

    await page.getByRole("button", { name: "العب مرة ثانية" }).click();

    await expect(page.getByText("You are in the market")).toBeVisible();
    // The reset has to reach the server too, or the next visit resumes at the
    // ending the reader just chose to leave.
    await expect
      .poll(() => db.rows("story_progress")[0])
      .toMatchObject({ path_taken: [0], completed: false });
  });

  test("resumes an unfinished story where the reader left it", async ({ page, db }) => {
    db.seed("story_progress", [
      {
        id: "dddddddd-0000-4000-8000-000000000000",
        user_id: TEST_USER_ID,
        story_id: STORY,
        current_scene_id: aScene(2).id,
        completed: false,
        path_taken: [0, 2],
        started_at: new Date().toISOString(),
        completed_at: null,
      },
    ]);

    await page.goto(`/stories/${STORY}`);

    await expect(page.getByText("You are more lost than before")).toBeVisible();
    await expect(page.getByText("المشهد 2 · 3 مشاهد بالكل")).toBeVisible();
  });

  test("starts a finished story from the beginning", async ({ page, db }) => {
    db.seed("story_progress", [
      {
        id: "dddddddd-0000-4000-8000-000000000000",
        user_id: TEST_USER_ID,
        story_id: STORY,
        current_scene_id: aScene(1).id,
        completed: true,
        path_taken: [0, 1],
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    ]);

    await page.goto(`/stories/${STORY}`);

    // Resuming onto the trophy screen would leave a reader with nothing to do
    // but restart, so a completed run is not restored.
    await expect(page.getByText("You are in the market")).toBeVisible();
  });

  test("offers a way out when a choice points at a scene that is not there", async ({
    page,
    db,
  }) => {
    db.seed("story_scenes", [
      aScene(0, {
        choices: [{ text_english: "Go on", text_arabic: "روح", next_scene_order: 99 }],
      }),
    ]);

    await page.goto(`/stories/${STORY}`);
    await page.getByText("Go on").click();

    // Nothing validates that a choice's target exists — not the admin form, not
    // the schema. A dead end with no restart would strand the reader on a page
    // whose only other control is the browser back button.
    await expect(page.getByText(/ما لقينا المشهد/i)).toBeVisible();
    await page.getByRole("button", { name: "ابدأ القصة من جديد" }).click();
    await expect(page.getByText("Scene number 0")).toBeVisible();
  });

  test("says so when a story has no scenes at all", async ({ page, db }) => {
    db.seed("story_scenes", []);

    await page.goto(`/stories/${STORY}`);

    await expect(page.getByText(/هذي القصة ما فيها مشاهد بعد/i)).toBeVisible();
    await page.getByRole("button", { name: "رجوع للقصص" }).click();
    await expect(page).toHaveURL(/\/stories$/);
  });
});

test.describe("reading aids", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("interactive_stories", [aStory()]);
    db.seed("story_progress", []);
    db.seed("story_scenes", [
      aScene(0, {
        narrative_english: "You are in the market. The shopkeeper calls out to you.",
        narrative_arabic: "أنت في السوق. البائع ينادي عليك.",
        narrative_literal: "أنت في الـ سوق. الـ بائع ينادي عليك.",
        choices: [{ text_english: "Go on", text_arabic: "روح", next_scene_order: 1 }],
      }),
      aScene(1, { is_ending: true, ending_message: "Done" }),
    ]);
  });

  test("keeps the Arabic hidden until asked for", async ({ page }) => {
    await page.goto(`/stories/${STORY}`);
    await expect(page.getByText("You are in the market. The shopkeeper calls out to you.")).toBeVisible();

    await expect(page.getByText("أنت في السوق. البائع ينادي عليك.")).toHaveCount(0);

    await page.getByRole("button", { name: "ورّني الترجمة" }).click();
    await expect(page.getByText("أنت في السوق. البائع ينادي عليك.")).toBeVisible();
  });

  test("hides it again", async ({ page }) => {
    await page.goto(`/stories/${STORY}`);
    await page.getByRole("button", { name: "ورّني الترجمة" }).click();
    await expect(page.getByText("أنت في السوق. البائع ينادي عليك.")).toBeVisible();

    await page.getByRole("button", { name: "أخفِ الترجمة" }).click();
    await expect(page.getByText("أنت في السوق. البائع ينادي عليك.")).toHaveCount(0);
  });

  test("pairs each English sentence with its Arabic in line-by-line view", async ({ page }) => {
    await page.goto(`/stories/${STORY}`);
    await page.getByRole("button", { name: "سطراً سطراً" }).click();

    // The split is on sentence terminators and the two languages are aligned by
    // index, so a paragraph that splits into a different number of sentences in
    // each language silently mispairs them.
    await expect(page.getByText("You are in the market.")).toBeVisible();
    await expect(page.getByText("أنت في السوق.")).toBeVisible();
    await expect(page.getByText("The shopkeeper calls out to you.")).toBeVisible();
    await expect(page.getByText("البائع ينادي عليك.")).toBeVisible();
  });

  test("drops the translation toggle in line-by-line view", async ({ page }) => {
    await page.goto(`/stories/${STORY}`);
    await page.getByRole("button", { name: "سطراً سطراً" }).click();

    // Line-by-line already shows the Arabic, so the toggle would do nothing.
    await expect(page.getByRole("button", { name: /الترجمة/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "عرض الفقرة" })).toBeVisible();
  });

  test("leaves a sentence unpaired when the two languages split differently", async ({
    page,
    db,
  }) => {
    db.seed("story_scenes", [
      aScene(0, {
        // Two English sentences, one Arabic one — what a translator writing
        // naturally produces.
        narrative_english: "You are in the market. The shopkeeper calls out.",
        narrative_arabic: "أنت في السوق والبائع ينادي عليك",
        choices: [{ text_english: "Go on", text_arabic: "روح", next_scene_order: 1 }],
      }),
      aScene(1, { is_ending: true }),
    ]);

    await page.goto(`/stories/${STORY}`);
    await page.getByRole("button", { name: "سطراً سطراً" }).click();

    // Pinning the consequence: the second English sentence gets no Arabic at
    // all, rather than sharing the one that covers both. Nothing warns the
    // editor, and it reads as a missing translation.
    await expect(page.getByText("أنت في السوق والبائع ينادي عليك")).toBeVisible();
    await expect(page.getByText("The shopkeeper calls out.")).toBeVisible();
  });
});

test.describe("saving a word from a scene", () => {
  const withVocabulary = (db: MemoryDb) => {
    db.seed("interactive_stories", [aStory()]);
    db.seed("story_progress", []);
    db.seed("user_vocabulary", []);
    db.seed("story_scenes", [
      aScene(0, {
        narrative_english: "You are in the market. The shopkeeper sells dates.",
        narrative_arabic: "أنت في السوق. البائع يبيع تمر.",
        vocabulary: [{ word_english: "dates", word_arabic: "تمر" }],
        choices: [{ text_english: "Go on", text_arabic: "روح", next_scene_order: 1 }],
      }),
      aScene(1, { is_ending: true }),
    ]);
  };

  test("saves the word with the sentence it appeared in", async ({ page, signInAs, db }) => {
    await signInAs("free");
    withVocabulary(db);

    await page.goto(`/stories/${STORY}`);
    // Exact name: the narrative's own tappable "dates." (with the full stop)
    // is a different control from the vocabulary pill.
    await page.getByRole("button", { name: "dates", exact: true }).click();

    await expect(page.getByText("حفظناها في كلماتي")).toBeVisible();
    await expect.poll(() => db.rows("user_vocabulary").length).toBe(1);
    // The sentence containing the word, not the whole scene: a flashcard whose
    // example is three sentences long is not a usable example.
    expect(db.rows("user_vocabulary")[0]).toMatchObject({
      word_english: "dates",
      word_arabic: "تمر",
      source: "story",
      sentence_text: "البائع يبيع تمر.",
      sentence_english: "The shopkeeper sells dates.",
    });
  });

  test("marks the word as saved so it cannot be saved twice", async ({ page, signInAs, db }) => {
    await signInAs("free");
    withVocabulary(db);

    await page.goto(`/stories/${STORY}`);
    await page.getByRole("button", { name: "dates", exact: true }).click();
    await expect(page.getByText("حفظناها في كلماتي")).toBeVisible();

    await expect(page.getByRole("button", { name: "dates", exact: true })).toBeDisabled();
  });

  test("reports a failed save", async ({ page, signInAs, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    await signInAs("free");
    withVocabulary(db);
    db.failWrites("user_vocabulary", 500);

    await page.goto(`/stories/${STORY}`);
    await page.getByRole("button", { name: "dates", exact: true }).click();

    await expect(page.getByText("تعذّر الحفظ")).toBeVisible();
    await expect(page.getByRole("button", { name: "dates", exact: true })).toBeEnabled();
  });

  test("gives a signed-out reader a dead button rather than a prompt", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("anonymous");
    withVocabulary(db);

    await page.goto(`/stories/${STORY}`);

    // The handler opens with `if (!user) toast.error('Sign in to save words')`,
    // but the same button is `disabled={isSaved || !user}` — so the click never
    // lands and that message is unreachable. A signed-out reader sees a word
    // pill with a plus on it that does nothing, and is told nothing.
    await expect(page.getByRole("button", { name: "dates", exact: true })).toBeDisabled();
    await expect(page.getByText("سجّل دخولك عشان تحفظ الكلمات")).toHaveCount(0);
  });
});
