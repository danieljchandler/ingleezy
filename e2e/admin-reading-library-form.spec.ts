import { expect, test } from "./support/fixtures";
import {
  anAuthenticStory,
  anAuthenticStoryLine,
  storyId,
  storyLineId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * Importing and producing an authentic story: the reading library's editor.
 *
 * This is the longest production pipeline in the admin — text in, then AI
 * segmentation, dialect translation, two tiers of narration, a preview
 * slideshow frame, an approval, a full slideshow, and finally publication.
 * Each stage is a separate edge function and a separate status column, and the
 * form is the only place the sequence is visible.
 *
 * What the tests are for is the gating. Buttons appear and disappear on
 * `status`, `story_video_url`, `story_video_approved`, `video_status` and two
 * `*_status` columns, and getting one wrong either hides a step an admin needs
 * or offers an expensive one before its input exists.
 */

const STORY = storyId(0);

const importButton = (page: Page) => page.getByRole("button", { name: "Import & Process" });
const englishBody = (page: Page) =>
  page.getByPlaceholder("Paste the article, essay or story here…");

function seedStory(db: MemoryDb, over: Record<string, unknown> = {}, lines = 0) {
  db.seed("authentic_stories", [
    anAuthenticStory({
      id: STORY,
      title: "The Fox and the Grapes",
      title_arabic: "الثعلب والعنب",
      author: "Ibn al-Muqaffa",
      author_arabic: "ابن المقفع",
      source_name: "Hindawi Foundation",
      source_url: "https://hindawi.org/books/1",
      body_english: "A fox saw grapes hanging high.",
      status: "draft",
      ...over,
    }),
  ]);
  db.seed(
    "authentic_story_lines",
    Array.from({ length: lines }, (_, index) =>
      anAuthenticStoryLine({
        id: storyLineId(index),
        story_id: STORY,
        line_index: index,
        arabic: `سطر ${index}`,
        arabic_vocalized: `سَطْر ${index}`,
        english: `Line ${index}`,
        audio_url: index === 0 ? "data:audio/mpeg;base64,AAAA" : null,
      }),
    ),
  );
}

/** Wait for a write to land, then return its payload. */
async function writtenTo(db: MemoryDb, table: string): Promise<Record<string, unknown>[]> {
  await expect.poll(() => db.writesTo(table).length).toBeGreaterThan(0);
  return db.lastWriteTo(table)!.payload as Record<string, unknown>[];
}

test.beforeEach(async ({ signInAs }) => {
  await signInAs("admin");
});

test.describe("importing a new story", () => {
  test("asks for the text before anything else", async ({ page }) => {
    await page.goto("/admin/reading-library/new");

    await expect(page.getByRole("heading", { name: "Import Authentic Story" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "English Text" })).toBeVisible();
    // The production controls are meaningless until there is a story to work
    // on, so they are absent rather than disabled.
    await expect(page.getByText("Workflow Actions")).toHaveCount(0);
  });

  test("refuses to import without a title and a body", async ({ page, backend }) => {
    await page.goto("/admin/reading-library/new");
    await importButton(page).click();

    await expect(page.getByText("Please fill the title and the English body text")).toBeVisible();
    expect(backend.callsTo("import-authentic-story")).toHaveLength(0);
  });

  test("still refuses with a title but no text", async ({ page, backend }) => {
    await page.goto("/admin/reading-library/new");
    await page.getByPlaceholder("The Fox and the Grapes").fill("The Fox and the Grapes");
    await importButton(page).click();

    // Segmentation with no text produces a story with no lines, which reads
    // downstream as a completed import.
    await expect(page.getByText("Please fill the title and the English body text")).toBeVisible();
    expect(backend.callsTo("import-authentic-story")).toHaveLength(0);
  });

  test("imports with no dialect title, deriving one from the English", async ({ page, backend }) => {
    // An admin pasting a real English article is not necessarily an Arabic
    // writer, so the dialect title is generated rather than demanded of them.
    backend.stubFunction("import-authentic-story", { story: { id: STORY } });

    await page.goto("/admin/reading-library/new");
    await page.getByPlaceholder("The Fox and the Grapes").fill("The Fox and the Grapes");
    await englishBody(page).fill("A fox saw grapes hanging high.");
    await importButton(page).click();

    await expect(page.getByText("Story imported successfully!")).toBeVisible();
  });

  test("sends the whole citation, not just the text", async ({ page, backend }) => {
    backend.stubFunction("import-authentic-story", { story: { id: STORY } });

    await page.goto("/admin/reading-library/new");
    await page.getByPlaceholder("The Fox and the Grapes").fill("The Fox and the Grapes");
    await page.getByPlaceholder("الثعلب والعنب").fill("الثعلب والعنب");
    await page.getByPlaceholder("Ibn al-Muqaffa").fill("Ibn al-Muqaffa");
    await page.getByPlaceholder("ابن المقفع").fill("ابن المقفع");
    await page.getByPlaceholder("https://hindawi.org/...").fill("https://hindawi.org/books/1");
    await page.getByPlaceholder("Hindawi Foundation").fill("Hindawi Foundation");
    await englishBody(page).fill("A fox saw grapes hanging high.");
    await importButton(page).click();

    // The library republishes other people's writing, so author, source and
    // licence are the difference between attribution and appropriation.
    await expect(page.getByText("Story imported successfully!")).toBeVisible();
    expect(backend.lastCallTo("import-authentic-story")?.body).toMatchObject({
      title: "The Fox and the Grapes",
      title_arabic: "الثعلب والعنب",
      author: "Ibn al-Muqaffa",
      author_arabic: "ابن المقفع",
      source_url: "https://hindawi.org/books/1",
      source_name: "Hindawi Foundation",
      license: "public_domain",
      body_english: "A fox saw grapes hanging high.",
      dialect: "Gulf",
      difficulty: "intermediate",
    });
  });

  test("opens the imported story for editing", async ({ page, backend }) => {
    backend.stubFunction("import-authentic-story", { story: { id: STORY } });

    await page.goto("/admin/reading-library/new");
    await page.getByPlaceholder("The Fox and the Grapes").fill("The Fox and the Grapes");
    await page.getByPlaceholder("الثعلب والعنب").fill("الثعلب والعنب");
    await englishBody(page).fill("A fox saw grapes hanging high.");
    await importButton(page).click();

    // Import is step one of eight; landing back on the list would make the
    // admin find the story again to continue.
    await expect(page).toHaveURL(new RegExp(`/admin/reading-library/${STORY}/edit$`));
  });

  test("prefills from the query string a suggestion arrived with", async ({ page }) => {
    // The suggestion flow links here with the title and level already chosen.
    await page.goto(
      "/admin/reading-library/new?title=The%20Fox&title_arabic=%D8%A7%D9%84%D8%AB%D8%B9%D9%84%D8%A8&dialect=Egyptian&difficulty=advanced",
    );

    await expect(page.getByPlaceholder("The Fox and the Grapes")).toHaveValue("The Fox");
    await expect(page.getByPlaceholder("الثعلب والعنب")).toHaveValue("الثعلب");
  });

  test("says so when the import fails", async ({ page, backend }) => {
    backend.stubFunctionFailure("import-authentic-story", 500, { error: "segmentation failed" });

    await page.goto("/admin/reading-library/new");
    await page.getByPlaceholder("The Fox and the Grapes").fill("The Fox and the Grapes");
    await page.getByPlaceholder("الثعلب والعنب").fill("الثعلب والعنب");
    await englishBody(page).fill("A fox saw grapes hanging high.");
    await importButton(page).click();

    // Still on the form with the pasted text intact — the text is the expensive
    // part to reproduce.
    await expect(page).toHaveURL(/\/admin\/reading-library\/new$/);
    await expect(englishBody(page)).toHaveValue("A fox saw grapes hanging high.");
  });
});

test.describe("the editor for an imported story", () => {
  test("loads the story's metadata back into the form", async ({ page, db }) => {
    seedStory(db);

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByRole("heading", { name: "Edit Authentic Story" })).toBeVisible();
    await expect(page.getByPlaceholder("The Fox and the Grapes")).toHaveValue("The Fox and the Grapes");
    await expect(page.getByPlaceholder("Ibn al-Muqaffa")).toHaveValue("Ibn al-Muqaffa");
    await expect(page.getByPlaceholder("Hindawi Foundation")).toHaveValue("Hindawi Foundation");
  });

  test("shows where the story is in the pipeline", async ({ page, db }) => {
    seedStory(db, { status: "content_approved" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByText("content_approved")).toBeVisible();
  });

  test("lists the segmented lines with their translations", async ({ page, db }) => {
    seedStory(db, {}, 3);

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByText("Story Lines (3)")).toBeVisible();
    // English first — it is the story. The dialect gloss sits under it.
    await expect(page.getByText("Line 0")).toBeVisible();
    await expect(page.getByText("سطر 0")).toBeVisible();
  });

  test("marks which lines already have narration", async ({ page, db }) => {
    seedStory(db, {}, 3);

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    // One of the three was seeded with audio. The speaker badge is how an
    // admin sees a partial synthesis run without opening every line.
    await expect(page.getByText("🔊")).toHaveCount(1);
    await expect(page.locator("audio")).toHaveCount(1);
  });

  test("hides the paste box once the story is imported", async ({ page, db }) => {
    seedStory(db);

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    // Pinned. The English Text card is new-story only, so there is no way back
    // to the source text from the editor — a mis-segmented story has to be
    // deleted and re-imported rather than corrected.
    await expect(englishBody(page)).toHaveCount(0);
  });
});

test.describe("the production pipeline", () => {
  test("offers content approval only while the story is a draft", async ({ page, db }) => {
    seedStory(db, { status: "draft" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await expect(page.getByRole("button", { name: "Approve Content" })).toBeVisible();
    await page.getByRole("button", { name: "Approve Content" }).click();

    await expect(page.getByText("Content approved!")).toBeVisible();
    expect((await writtenTo(db, "authentic_stories"))[0]).toMatchObject({
      status: "content_approved",
    });
  });

  test("stops offering content approval afterwards", async ({ page, db }) => {
    seedStory(db, { status: "content_approved" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByRole("button", { name: "Approve Content" })).toHaveCount(0);
  });

  test("says so when approval is refused", async ({ page, db }) => {
    seedStory(db, { status: "draft" });
    db.failWrites("authentic_stories", 403, { message: "denied" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: "Approve Content" }).click();

    await expect(page.getByText("Failed to approve")).toBeVisible();
  });

  test("translates into the story's dialect", async ({ page, db, backend }) => {
    seedStory(db, { dialect: "Egyptian" });
    backend.stubFunction("translate-story-dialect", { success: true, lines_translated: 3 });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: "Translate to Dialect" }).click();

    await expect(page.getByText("Translated to Egyptian dialect")).toBeVisible();
    expect(backend.lastCallTo("translate-story-dialect")?.body).toMatchObject({ story_id: STORY });
  });

  test("offers translation before the content is approved", async ({ page, db }) => {
    seedStory(db, { status: "draft" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    // Pinned. Only the Approve and Publish buttons are gated on status —
    // translation, both audio tiers and the preview scene are offered on a
    // draft nobody has read yet, so the expensive stages can all be run against
    // text that is about to be rewritten.
    await expect(page.getByRole("button", { name: "Translate to Dialect" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Generate Preview Audio" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Generate Full Audio" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Generate Preview Scene" })).toBeEnabled();
  });

  test("generates the preview narration", async ({ page, db, backend }) => {
    seedStory(db);
    backend.stubFunction("generate-story-preview-audio", { success: true, preview_lines: 4 });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: "Generate Preview Audio" }).click();

    await expect(page.getByText("Preview generated (4 lines)")).toBeVisible();
    expect(backend.lastCallTo("generate-story-preview-audio")?.body).toMatchObject({ story_id: STORY });
  });

  test("generates the full narration", async ({ page, db, backend }) => {
    seedStory(db);
    backend.stubFunction("generate-story-full-audio", { success: true, total_duration: 182 });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: "Generate Full Audio" }).click();

    await expect(page.getByText("Full audio generated (182s)")).toBeVisible();
  });

  test("says so when narration fails", async ({ page, db, backend }) => {
    seedStory(db);
    backend.stubFunctionFailure("generate-story-full-audio", 500, { error: "voice unavailable" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: "Generate Full Audio" }).click();

    // Pinned. The catch re-throws `resp.error.message`, which for a non-2xx
    // edge response is supabase-js's own generic string — so the admin is told
    // "Edge Function returned a non-2xx status code" and never sees the
    // function's own `error` field explaining that the voice was unavailable.
    await expect(page.getByText(/non-2xx status code/)).toBeVisible();
    await expect(page.getByText(/voice unavailable/)).toHaveCount(0);
  });

  test("generates the preview scene", async ({ page, db, backend }) => {
    seedStory(db);
    backend.stubFunction("generate-story-video", { success: true });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: "Generate Preview Scene" }).click();

    await expect(page.getByText("Preview scene generated")).toBeVisible();
  });

  test("offers a regeneration once a preview exists", async ({ page, db }) => {
    seedStory(db, { story_video_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByRole("button", { name: "Regenerate Preview Scene" })).toBeVisible();
  });

  test("shows the preview scene for the admin to judge", async ({ page, db }) => {
    seedStory(db, { story_video_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    // Approving a frame nobody can see would make the gate a formality.
    await expect(page.getByAltText("Preview scene")).toBeVisible();
  });

  test("locks the preview button while one is generating", async ({ page, db }) => {
    seedStory(db, { story_video_status: "generating" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    const button = page.getByRole("button", { name: "Generating Preview…" });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  });

  test("approves the preview and unlocks the full slideshow", async ({ page, db }) => {
    seedStory(db, { story_video_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await expect(page.getByRole("button", { name: "Generate Full Slideshow" })).toHaveCount(0);
    await page.getByRole("button", { name: "Approve Preview" }).click();

    await expect(page.getByText("Preview approved")).toBeVisible();
    expect((await writtenTo(db, "authentic_stories"))[0]).toMatchObject({
      story_video_approved: true,
    });
  });

  test("offers no approval until a preview exists", async ({ page, db }) => {
    seedStory(db);

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    // Approving nothing would let the six-scene render start with no reference
    // frame to match.
    await expect(page.getByRole("button", { name: "Approve Preview" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Generate Full Slideshow" })).toHaveCount(0);
  });

  test("stops offering approval once given", async ({ page, db }) => {
    seedStory(db, {
      story_video_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      story_video_approved: true,
    });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByRole("button", { name: "Approve Preview" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Generate Full Slideshow" })).toBeVisible();
  });

  test("starts the full slideshow", async ({ page, db, backend }) => {
    seedStory(db, { story_video_approved: true });
    backend.stubFunction("generate-story-video-full", { status: "generating", scenes: 5 });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: "Generate Full Slideshow" }).click();

    await expect(page.getByText("Full slideshow generation started")).toBeVisible();
    expect(backend.lastCallTo("generate-story-video-full")?.body).toMatchObject({ story_id: STORY });
  });

  test("locks the slideshow button while one is rendering", async ({ page, db }) => {
    seedStory(db, { story_video_approved: true, story_video_full_status: "generating" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    const button = page.getByRole("button", { name: "Generating Full Slideshow…" });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  });

  test("surfaces the reason a slideshow failed", async ({ page, db }) => {
    seedStory(db, {
      story_video_approved: true,
      story_video_full_status: "failed",
      story_video_full_error: "no scenes generated",
    });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByText("Full slideshow error: no scenes generated")).toBeVisible();
  });

  test("publishes only once the audio is ready", async ({ page, db }) => {
    seedStory(db, { video_status: "ready", status: "content_approved" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByText("Story published!")).toBeVisible();
    expect((await writtenTo(db, "authentic_stories"))[0]).toMatchObject({ status: "published" });
  });

  test("offers no publish before the audio is ready", async ({ page, db }) => {
    seedStory(db, { video_status: "none", status: "content_approved" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  });

  test("offers no publish on an already published story", async ({ page, db }) => {
    seedStory(db, { video_status: "ready", status: "published" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  });

  test("gives no way to unpublish a story", async ({ page, db }) => {
    seedStory(db, { video_status: "ready", status: "published" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    // Pinned. Publication is one-way from this form: there is no Unpublish and
    // no status control, so pulling a story with a bad translation means
    // editing the row by hand.
    await expect(page.getByRole("button", { name: /Unpublish|Withdraw|Draft/ })).toHaveCount(0);
  });
});

test.describe("editing a rendered scene", () => {
  const withSegments = {
    story_video_approved: true,
    story_video_full_status: "ready",
    story_video_segments: [
      {
        index: 0,
        image_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        audio_url: "data:audio/mpeg;base64,AAAA",
        narration_arabic: "كان يا ما كان",
        arabic_beat: "كان يا ما كان",
        duration_seconds: 5,
        prompt: "A fox looking up at grapes",
      },
      {
        index: 1,
        image_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        audio_url: "data:audio/mpeg;base64,AAAA",
        narration_arabic: "ثم مشى",
        arabic_beat: "ثم مشى",
        duration_seconds: 4,
        prompt: "The fox walking away",
      },
    ],
  };

  test("offers a button per rendered scene", async ({ page, db }) => {
    seedStory(db, withSegments);

    await page.goto(`/admin/reading-library/${STORY}/edit`);

    await expect(page.getByRole("button", { name: "Scene 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Scene 2" })).toBeVisible();
  });

  test("regenerates one scene from an edited prompt", async ({ page, db, backend }) => {
    seedStory(db, withSegments);
    backend.stubFunction("edit-story-scene-image", { success: true });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: "Scene 2" }).click();
    await page.getByRole("button", { name: /Edit prompt|Edit/ }).first().click();
    await page.getByPlaceholder("Image prompt sent to the generator").fill("The fox giving up");
    await page.getByRole("button", { name: "Regenerate with new prompt" }).click();

    // The scene index is what makes this surgical — regenerating the whole
    // slideshow to fix one frame costs six image generations.
    await expect(page.getByText("Scene 2 image regenerated")).toBeVisible();
    expect(backend.lastCallTo("edit-story-scene-image")?.body).toMatchObject({
      story_id: STORY,
      scene_index: 1,
      prompt: "The fox giving up",
    });
  });

  test("says so when a scene regeneration fails", async ({ page, db, backend }) => {
    seedStory(db, withSegments);
    backend.stubFunctionFailure("edit-story-scene-image", 500, { error: "model refused" });

    await page.goto(`/admin/reading-library/${STORY}/edit`);
    await page.getByRole("button", { name: /Edit prompt|Edit/ }).first().click();
    await page.getByPlaceholder("Image prompt sent to the generator").fill("Something else");
    await page.getByRole("button", { name: "Regenerate with new prompt" }).click();

    // Same shape as the audio failure: the generic transport message reaches
    // the admin rather than the function's own reason.
    await expect(page.getByText(/non-2xx status code/)).toBeVisible();
  });
});

test.describe("getting in", () => {
  test("turns a plain learner away", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/admin/reading-library/new");

    await expect(page.getByRole("heading", { name: "Import Authentic Story" })).toHaveCount(0);
  });

  test("turns a content reviewer away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");

    await page.goto("/admin/reading-library/new");

    await expect(page.getByRole("heading", { name: "Import Authentic Story" })).toHaveCount(0);
  });
});
