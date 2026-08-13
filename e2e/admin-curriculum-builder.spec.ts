import { expect, test } from "./support/fixtures";
import {
  aCurriculumChatMessage,
  aCurriculumChatSession,
  aLesson,
  aStage,
  chatMessageId,
  chatSessionId,
  lessonId,
  many,
  stageId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * The Curriculum Builder: an AI chat that writes curriculum, and the approval
 * step that lets it into the database.
 *
 * The chat half is ordinary. The approval half is not — clicking Publish in the
 * preview panel is the only gate between a language model's output and content
 * a learner is taught, and each of the eight preview types writes to a
 * different table with a different shape. What matters is that the thing
 * published is the thing on screen: the JSON editor can rewrite a preview
 * before it is approved, and the vocabulary card publishes only the ticked
 * words.
 *
 * Sessions are scoped to the active dialect. A session built for Egyptian is
 * not greyed out for a Gulf admin, it is absent, which is worth pinning because
 * "my session disappeared" and "my session was deleted" look identical.
 */

const SESSION = chatSessionId(0);
const STAGE = stageId(0);
const LESSON = lessonId(0);

const sessionRows = (page: Page) => page.locator('div[role="button"].cursor-pointer');
const composer = (page: Page) => page.getByRole("textbox");
/**
 * Send by pressing Enter rather than clicking the button.
 *
 * The send button sits bottom-right of the composer, directly underneath the
 * admin layout's floating alerts bell, which intercepts the click. Enter is the
 * documented way to send anyway — the placeholder says so.
 */
const send = (page: Page) => composer(page).press("Enter");

/**
 * Wait for a write to land, then return its payload.
 *
 * Every publish here is a mutation fired from a click handler, so the click
 * resolves well before the row is sent. Polling the journal rather than
 * sleeping keeps the assertion about the write itself.
 */
async function writtenTo(db: MemoryDb, table: string): Promise<Record<string, unknown>[]> {
  await expect.poll(() => db.writesTo(table).length).toBeGreaterThan(0);
  return db.lastWriteTo(table)!.payload as Record<string, unknown>[];
}

/** A session with `messages` turns already in it. */
function seedSession(
  db: MemoryDb,
  {
    messages = [],
    session = {},
  }: { messages?: Record<string, unknown>[]; session?: Record<string, unknown> } = {},
) {
  db.seed("curriculum_chat_sessions", [
    aCurriculumChatSession({ id: SESSION, title: "Household objects", ...session }),
  ]);
  db.seed("curriculum_chat_messages", messages);
  db.seed("curriculum_stages", [aStage({ id: STAGE, name: "Foundations", stage_number: 1 })]);
  db.seed("lessons", [aLesson({ id: LESSON, stage_id: STAGE, title: "Around the house" })]);
}

/** An assistant turn carrying a previewable payload. */
const aPreview = (outputType: string, structured: Record<string, unknown>, index = 1) =>
  aCurriculumChatMessage({
    id: chatMessageId(index),
    session_id: SESSION,
    role: "assistant",
    content: "Here you go.",
    output_type: outputType,
    structured_output: structured,
  });

const GRAMMAR = {
  category: "verb-conjugation",
  difficulty: "beginner",
  exercises: [
    {
      question_arabic: "أنا ___ إلى السوق",
      question_english: "I ___ to the market",
      grammar_point: "present tense",
      choices: ["أروح", "راح", "يروح"],
      correct_index: 0,
      explanation: "First person present.",
    },
    {
      question_arabic: "هو ___ الكتاب",
      question_english: "He ___ the book",
      grammar_point: "present tense",
      choices: ["يقرأ", "أقرأ", "نقرأ"],
      correct_index: 0,
      explanation: "Third person present.",
    },
  ],
};

const VOCAB = {
  vocabulary: [
    { word_arabic: "باب", word_english: "door", transliteration: "baab", category: "objects" },
    { word_arabic: "كتاب", word_english: "book", transliteration: "kitaab", category: "objects" },
    { word_arabic: "كرسي", word_english: "chair", transliteration: "kursi", category: "objects" },
  ],
};

test.beforeEach(async ({ signInAs }) => {
  await signInAs("admin");
});

test.describe("getting oriented", () => {
  test("explains itself when nothing is open", async ({ page, db }) => {
    db.seed("curriculum_chat_sessions", []);

    await page.goto("/admin/curriculum-builder");

    // Two headings carry this name — the header's h1 and the empty state's h3.
    await expect(page.locator("h1")).toHaveText("Curriculum Builder");
    await expect(page.getByText("No conversations yet.")).toBeVisible();
    await expect(page.getByText("Create a new session or pick one from the sidebar")).toBeVisible();
  });

  test("will not let a message be typed with no session", async ({ page, db }) => {
    db.seed("curriculum_chat_sessions", []);

    await page.goto("/admin/curriculum-builder");

    // The composer is disabled rather than hidden, so there is somewhere for
    // the "start a session first" affordance to point.
    await expect(composer(page)).toBeDisabled();
  });

  test("lists the sessions for the active dialect", async ({ page, db }) => {
    db.seed("curriculum_chat_sessions", [
      aCurriculumChatSession({ id: chatSessionId(0), title: "Gulf greetings", target_dialect: "Gulf" }),
      aCurriculumChatSession({ id: chatSessionId(1), title: "Egyptian food", target_dialect: "Egyptian" }),
    ]);

    await page.goto("/admin/curriculum-builder");

    // Pinned. The Egyptian session is filtered out client-side with nothing
    // saying so — no count, no "switch dialect to see 1 more". An admin who
    // changes dialect and comes back sees their work gone.
    await expect(page.getByText("Gulf greetings")).toBeVisible();
    await expect(page.getByText("Egyptian food")).toHaveCount(0);
  });

  test("leaves out an archived session", async ({ page, db }) => {
    db.seed("curriculum_chat_sessions", [
      aCurriculumChatSession({ id: chatSessionId(0), title: "Live one" }),
      aCurriculumChatSession({ id: chatSessionId(1), title: "Archived one", status: "archived" }),
    ]);

    await page.goto("/admin/curriculum-builder");

    await expect(page.getByText("Live one")).toBeVisible();
    await expect(page.getByText("Archived one")).toHaveCount(0);
  });

  test("opens the session named in the URL", async ({ page, db }) => {
    seedSession(db, {
      messages: [
        aCurriculumChatMessage({
          id: chatMessageId(0),
          session_id: SESSION,
          role: "user",
          content: "Build me a lesson on the house",
        }),
      ],
    });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);

    // Deep-linking is how a session is shared between admins; without it the
    // URL is decoration.
    await expect(page.getByText("Build me a lesson on the house")).toBeVisible();
  });

  test("titles the header with the open session", async ({ page, db }) => {
    seedSession(db);

    await page.goto(`/admin/curriculum-builder/${SESSION}`);

    await expect(page.getByRole("heading", { name: "Household objects" })).toBeVisible();
  });

  test("invites the first message in an empty session", async ({ page, db }) => {
    seedSession(db);

    await page.goto(`/admin/curriculum-builder/${SESSION}`);

    await expect(page.getByText("Tell the AI what to build")).toBeVisible();
  });
});

test.describe("starting a session", () => {
  test("offers the dialect, model, stage and level", async ({ page, db }) => {
    seedSession(db);

    await page.goto("/admin/curriculum-builder");
    await page.getByRole("button", { name: "New Session" }).click();

    await expect(page.getByRole("heading", { name: "New Curriculum Building Session" })).toBeVisible();
    for (const label of ["Target Dialect", "AI Model", "Target Stage (optional)", "CEFR Level (optional)"]) {
      await expect(page.getByText(label)).toBeVisible();
    }
  });

  test("writes the session against the signed-in admin", async ({ page, db }) => {
    seedSession(db);

    await page.goto("/admin/curriculum-builder");
    await page.getByRole("button", { name: "New Session" }).click();
    await page.getByRole("button", { name: "Start Session" }).click();

    const written = (await writtenTo(db, "curriculum_chat_sessions"))[0];
    expect(written).toMatchObject({
      target_dialect: "Gulf",
      llm_model: "google/gemini-3-flash-preview",
    });
    // Ownership matters: RLS scopes a session to its author.
    expect(written?.admin_id).toBeTruthy();
  });

  test("leaves an unchosen stage and level null rather than 'any'", async ({ page, db }) => {
    seedSession(db);

    await page.goto("/admin/curriculum-builder");
    await page.getByRole("button", { name: "New Session" }).click();
    await page.getByRole("combobox").filter({ hasText: "Any stage" }).click();
    await page.getByRole("option", { name: "Any stage" }).click();
    await page.getByRole("button", { name: "Start Session" }).click();

    // "any" is the Radix sentinel — Select cannot hold an empty value — and it
    // must not reach the column, or every query filtering on stage misses.
    const written = (await writtenTo(db, "curriculum_chat_sessions"))[0];
    expect(written.target_stage_id).toBeNull();
    expect(written.target_cefr).toBeNull();
  });

  test("records the stage and level when they are chosen", async ({ page, db }) => {
    seedSession(db);

    await page.goto("/admin/curriculum-builder");
    await page.getByRole("button", { name: "New Session" }).click();
    await page.getByRole("combobox").filter({ hasText: "Any stage" }).click();
    await page.getByRole("option", { name: "Stage 1: Foundations" }).click();
    await page.getByRole("combobox").filter({ hasText: "Any level" }).click();
    await page.getByRole("option", { name: "A2", exact: true }).click();
    await page.getByRole("button", { name: "Start Session" }).click();

    const written = (await writtenTo(db, "curriculum_chat_sessions"))[0];
    expect(written.target_stage_id).toBe(STAGE);
    expect(written.target_cefr).toBe("A2");
  });

  test("closes the dialog without writing on Cancel", async ({ page, db }) => {
    seedSession(db);

    await page.goto("/admin/curriculum-builder");
    await page.getByRole("button", { name: "New Session" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("heading", { name: "New Curriculum Building Session" })).toHaveCount(0);
    expect(db.lastWriteTo("curriculum_chat_sessions")).toBeUndefined();
  });

  test("says so when the session cannot be created", async ({ page, db }) => {
    seedSession(db);
    db.failWrites("curriculum_chat_sessions", 403, { message: "new row violates row-level security policy" });

    await page.goto("/admin/curriculum-builder");
    await page.getByRole("button", { name: "New Session" }).click();
    await page.getByRole("button", { name: "Start Session" }).click();

    await expect(page.getByText("Failed to create session")).toBeVisible();
    // The dialog stays open, so the choices are not lost.
    await expect(page.getByRole("heading", { name: "New Curriculum Building Session" })).toBeVisible();
  });

  test("archives a session rather than deleting it", async ({ page, db }) => {
    seedSession(db);

    await page.goto("/admin/curriculum-builder");
    await sessionRows(page).first().hover();
    await page.getByTitle("Archive session").click();

    // Nothing here is ever destroyed — the sessions carry the reasoning behind
    // published content, so they are hidden rather than removed.
    expect((await writtenTo(db, "curriculum_chat_sessions"))[0]).toMatchObject({
      status: "archived",
    });
    expect(db.writesTo("curriculum_chat_sessions").some((w) => w.method === "DELETE")).toBe(false);
  });
});

test.describe("talking to the model", () => {
  test("persists the admin's turn before calling the model", async ({ page, db, backend }) => {
    seedSession(db);
    backend.stubFunction("curriculum-chat", { content: "Here is a plan." });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await composer(page).fill("Build a lesson about the kitchen");
    await send(page);

    await expect(page.getByText("Here is a plan.")).toBeVisible();
    const writes = db.writesTo("curriculum_chat_messages");
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes[0].payload[0]).toMatchObject({
      session_id: SESSION,
      role: "user",
      content: "Build a lesson about the kitchen",
    });
  });

  test("sends the session's model and dialect, not the page's", async ({ page, db, backend }) => {
    seedSession(db, { session: { llm_model: "anthropic/claude-sonnet-4", target_dialect: "Gulf", target_cefr: "A2" } });
    backend.stubFunction("curriculum-chat", { content: "ok" });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await composer(page).fill("hello");
    await send(page);
    await expect(page.getByText("ok")).toBeVisible();

    // A session is a fixed brief: switching the app's dialect mid-conversation
    // must not change what the model is told it is writing.
    expect(backend.lastCallTo("curriculum-chat")?.body).toMatchObject({
      model: "anthropic/claude-sonnet-4",
      dialect: "Gulf",
      stage_context: { cefr: "A2" },
      mode: "chat",
    });
  });

  test("carries the conversation so far as context", async ({ page, db, backend }) => {
    seedSession(db, {
      messages: [
        aCurriculumChatMessage({ id: chatMessageId(0), session_id: SESSION, role: "user", content: "First question" }),
        aCurriculumChatMessage({ id: chatMessageId(1), session_id: SESSION, role: "assistant", content: "First answer" }),
      ],
    });
    backend.stubFunction("curriculum-chat", { content: "Second answer" });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await expect(page.getByText("First answer")).toBeVisible();
    await composer(page).fill("Second question");
    await send(page);
    await expect(page.getByText("Second answer")).toBeVisible();

    const sent = backend.lastCallTo("curriculum-chat")?.body as { messages: Array<Record<string, string>> };
    expect(sent.messages.map((m) => m.content)).toEqual([
      "First question",
      "First answer",
      "Second question",
    ]);
  });

  test("names the session after the first thing asked of it", async ({ page, db, backend }) => {
    seedSession(db, { session: { title: "New session" } });
    backend.stubFunction("curriculum-chat", { content: "ok" });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await composer(page).fill("Vocabulary for talking about the weather");
    await send(page);
    await expect(page.getByText("ok")).toBeVisible();

    // A sidebar of sessions all called "New session" is unusable.
    expect(db.lastWriteTo("curriculum_chat_sessions")?.payload[0]).toMatchObject({
      title: "Vocabulary for talking about the weather",
    });
  });

  test("truncates a long opening message into a readable title", async ({ page, db, backend }) => {
    seedSession(db, { session: { title: "New session" } });
    backend.stubFunction("curriculum-chat", { content: "ok" });
    const long = "Generate a really thorough lesson covering every single household object I can think of";

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await composer(page).fill(long);
    await send(page);
    await expect(page.getByText("ok")).toBeVisible();

    const title = db.lastWriteTo("curriculum_chat_sessions")?.payload[0].title as string;
    expect(title).toBe(long.slice(0, 60) + "...");
  });

  test("does not rename a session that already has history", async ({ page, db, backend }) => {
    seedSession(db, {
      session: { title: "Household objects" },
      messages: [
        aCurriculumChatMessage({ id: chatMessageId(0), session_id: SESSION, role: "user", content: "Earlier" }),
      ],
    });
    backend.stubFunction("curriculum-chat", { content: "ok" });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await expect(page.getByText("Earlier")).toBeVisible();
    await composer(page).fill("Another request");
    await send(page);
    await expect(page.getByText("ok")).toBeVisible();

    expect(db.lastWriteTo("curriculum_chat_sessions")).toBeUndefined();
  });

  test("switches mode and sends the mode with the request", async ({ page, db, backend }) => {
    seedSession(db);
    backend.stubFunction("curriculum-chat", { content: "ok" });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await page.getByRole("button", { name: "Lesson" }).click();
    await composer(page).fill("the kitchen");
    await send(page);
    await expect(page.getByText("ok")).toBeVisible();

    // The mode is what selects the tool schema server-side; sending it as prose
    // would leave the output unstructured.
    expect(backend.lastCallTo("curriculum-chat")?.body).toMatchObject({ mode: "generate_lesson" });
  });

  test("says so when the model fails", async ({ page, db, backend }) => {
    seedSession(db);
    backend.stubFunctionFailure("curriculum-chat", 500, { error: "gateway timeout" });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await composer(page).fill("hello");
    await send(page);

    await expect(page.getByText("Failed to get AI response")).toBeVisible();
  });

  test("keeps the admin's turn when the model fails", async ({ page, db, backend }) => {
    seedSession(db);
    backend.stubFunctionFailure("curriculum-chat", 500);

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await composer(page).fill("worth keeping");
    await send(page);
    await expect(page.getByText("Failed to get AI response")).toBeVisible();

    // Pinned as intended: the user message is written before the call, so a
    // failed generation leaves the question in the transcript to retry from
    // rather than discarding what was typed.
    const writes = db.writesTo("curriculum_chat_messages");
    expect(writes[0].payload[0]).toMatchObject({ role: "user", content: "worth keeping" });
  });

  test("treats an empty answer as a failure", async ({ page, db, backend }) => {
    seedSession(db);
    backend.stubFunction("curriculum-chat", { model: "google/gemini-3-flash-preview" });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await composer(page).fill("hello");
    await send(page);

    // A 200 with no content would otherwise persist a blank assistant turn.
    await expect(page.getByText("Empty response from AI")).toBeVisible();
  });

  test("refuses to send an empty message", async ({ page, db }) => {
    seedSession(db);

    await page.goto(`/admin/curriculum-builder/${SESSION}`);

    const button = page.locator("button:has(svg.lucide-send)");
    await expect(button).toBeDisabled();
    await composer(page).fill("   ");
    await expect(button).toBeDisabled();
  });
});

test.describe("previewing what the model wrote", () => {
  test("opens the newest preview by itself", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("grammar_preview", GRAMMAR)] });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);

    // The preview is the whole point of the turn; making the admin hunt for it
    // is a step nobody would want.
    await expect(page.getByRole("heading", { name: "Grammar", exact: true })).toBeVisible();
    await expect(page.getByText("Grammar Exercises (2)")).toBeVisible();
  });

  test("shows the exercises it is offering to publish", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("grammar_preview", GRAMMAR)] });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);

    await expect(page.getByText("أنا ___ إلى السوق")).toBeVisible();
    await expect(page.getByText("I ___ to the market")).toBeVisible();
    await expect(page.getByText("verb-conjugation")).toBeVisible();
  });

  test("closes the preview without losing the message", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("grammar_preview", GRAMMAR)] });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await expect(page.getByText("Grammar Exercises (2)")).toBeVisible();
    await page.getByRole("button", { name: "Grammar ready" }).click();

    // The chat button reopens it — the preview is a view of the message, not a
    // one-shot notification.
    await expect(page.getByText("Grammar Exercises (2)")).toBeVisible();
  });

  test("publishes the exercises against the session that produced them", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("grammar_preview", GRAMMAR)] });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await page.getByRole("button", { name: "Publish 2 exercises" }).click();

    await expect(page.getByText("2 grammar exercises published!")).toBeVisible();
    const rows = db.lastWriteTo("grammar_exercises")?.payload as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      question_arabic: "أنا ___ إلى السوق",
      grammar_point: "present tense",
      correct_index: 0,
      category: "verb-conjugation",
      difficulty: "beginner",
      // The provenance link: which conversation produced this exercise.
      session_id: SESSION,
      status: "published",
    });
  });

  test("publishes straight to learners with no draft step", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("grammar_preview", GRAMMAR)] });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await page.getByRole("button", { name: "Publish 2 exercises" }).click();
    await expect(page.getByText("2 grammar exercises published!")).toBeVisible();

    // Pinned. One click takes model output to `status: "published"` — there is
    // no draft state and no second pair of eyes between the preview panel and
    // the grammar drill a learner is served.
    const rows = db.lastWriteTo("grammar_exercises")?.payload as Record<string, unknown>[];
    expect(rows.every((r) => r.status === "published")).toBe(true);
  });

  test("says so when publishing is refused", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("grammar_preview", GRAMMAR)] });
    db.failWrites("grammar_exercises", 403, { message: "new row violates row-level security policy" });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await page.getByRole("button", { name: "Publish 2 exercises" }).click();

    await expect(page.getByText("Failed to publish grammar exercises")).toBeVisible();
  });

  test("publishes a reading passage with its questions", async ({ page, db }) => {
    seedSession(db, {
      messages: [
        aPreview("reading_preview", {
          difficulty: "beginner",
          passage: {
            title: "في السوق",
            title_english: "At the market",
            passage: "ذهب أحمد إلى السوق.",
            passage_english: "Ahmed went to the market.",
            vocabulary: [{ arabic: "سوق", english: "market" }],
            questions: [{ question: "أين ذهب أحمد؟", answer: "السوق" }],
            cultural_note: "Souqs open after dawn prayer.",
          },
        }),
      ],
    });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await page.getByRole("button", { name: /Publish/ }).click();

    // The builder still emits the Arabic-era payload; the approval crosswires
    // it into the flipped columns, where `title`/`passage` are the ENGLISH the
    // reader treats as the passage and the Arabic becomes its scaffold.
    const row = (await writtenTo(db, "reading_passages"))[0];
    expect(row).toMatchObject({
      title: "At the market",
      title_arabic: "في السوق",
      passage: "Ahmed went to the market.",
      passage_arabic: "ذهب أحمد إلى السوق.",
      cultural_note: "Souqs open after dawn prayer.",
      difficulty: "beginner",
    });
  });

  test("publishes listening exercises with their prompts", async ({ page, db }) => {
    seedSession(db, {
      messages: [
        aPreview("listening_preview", {
          mode: "dictation",
          difficulty: "beginner",
          exercises: [
            { audio_text: "شلونك", audio_text_english: "How are you", options: [], hint: "greeting" },
          ],
        }),
      ],
    });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await page.getByRole("button", { name: /Publish/ }).click();

    expect((await writtenTo(db, "listening_exercises"))[0]).toMatchObject({
      mode: "dictation",
      audio_text: "شلونك",
      audio_text_english: "How are you",
      hint: "greeting",
      session_id: SESSION,
    });
  });
});

test.describe("editing a preview before publishing it", () => {
  test("publishes the edited JSON rather than the original", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("grammar_preview", GRAMMAR)] });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await page.getByRole("tab", { name: "JSON" }).click();

    const edited = JSON.parse(JSON.stringify(GRAMMAR)) as typeof GRAMMAR;
    edited.exercises[0].grammar_point = "corrected by hand";
    await page.locator("textarea.font-mono").fill(JSON.stringify(edited, null, 2));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Edits saved")).toBeVisible();

    await page.getByRole("tab", { name: "Preview" }).click();
    await page.getByRole("button", { name: "Publish 2 exercises" }).click();

    // The editor exists because the model gets details wrong; an edit that does
    // not reach the write would be worse than no editor at all.
    const rows = await writtenTo(db, "grammar_exercises");
    expect(rows[0].grammar_point).toBe("corrected by hand");
  });

  test("refuses to save JSON it cannot parse", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("grammar_preview", GRAMMAR)] });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await page.getByRole("tab", { name: "JSON" }).click();
    await page.locator("textarea.font-mono").fill("{ this is not json");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Invalid JSON/)).toBeVisible();
    expect(db.lastWriteTo("curriculum_chat_messages")).toBeUndefined();
  });
});

test.describe("approving vocabulary", () => {
  test("publishes only the words that are ticked", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("vocab_preview", VOCAB)] });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    // Every word starts selected; untick the middle one.
    await page.getByRole("checkbox").nth(2).click();
    await page.getByRole("combobox").filter({ hasText: "Select a lesson" }).click();
    await page.getByRole("option", { name: /Around the house/ }).click();
    await page.getByRole("button", { name: /^Add \d+ Words$/ }).click();

    const rows = await writtenTo(db, "vocabulary_words");
    expect(rows.map((r) => r.word_arabic)).toEqual(["باب", "كرسي"]);
  });

  test("attaches the words to the lesson that was picked", async ({ page, db }) => {
    seedSession(db, { messages: [aPreview("vocab_preview", VOCAB)] });

    await page.goto(`/admin/curriculum-builder/${SESSION}`);
    await page.getByRole("combobox").filter({ hasText: "Select a lesson" }).click();
    await page.getByRole("option", { name: /Around the house/ }).click();
    await page.getByRole("button", { name: /^Add \d+ Words$/ }).click();

    const rows = await writtenTo(db, "vocabulary_words");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.lesson_id === LESSON)).toBe(true);
  });
});

test.describe("getting in", () => {
  test("turns a plain learner away", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/admin/curriculum-builder");

    await expect(page.getByRole("button", { name: "New Session" })).toHaveCount(0);
  });

  test("turns a content reviewer away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");

    await page.goto("/admin/curriculum-builder");

    await expect(page.getByRole("button", { name: "New Session" })).toHaveCount(0);
  });
});
