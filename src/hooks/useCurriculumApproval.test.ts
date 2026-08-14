import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aLesson,
  aStage,
  aVocabularyWord,
  chatMessageId,
  chatSessionId,
  lessonId,
  stageId,
  TEST_USER_ID,
  wordId,
} from "@/test/support/factories";
import { useCurriculumApproval } from "./useCurriculumApproval";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The moment a drafted lesson becomes part of the syllabus.
 *
 * Everything upstream of this — the builder chat, the model, the admin's edits
 * — is reversible. This is not: an approved lesson is published, and the next
 * learner to open the curriculum sees it. Eight content types come through
 * here, and each lands in a different table with its own required shape.
 *
 * Two invariants run through all of them. Nothing is published without an
 * admin attached, because `created_by` is what makes a bad lesson traceable to
 * a person. And approving something records that it was approved, from which
 * message, in which session — the audit trail that lets somebody later ask why
 * a lesson says what it says.
 */

const SESSION = chatSessionId(0);
const MESSAGE = chatMessageId(0);
const STAGE = stageId(0);

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

function render(seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(() => useCurriculumApproval(), {
    persona: "admin",
    seed: (backend) => {
      backend.db.seed("curriculum_stages", [aStage({ id: STAGE })]);
      backend.stubFunction("extract-concepts", { success: true });
      seed(backend);
    },
  });
  cleanup = harness.cleanup;
  return harness;
}

const aLessonDraft = (over: Record<string, unknown> = {}) => ({
  title: "At the souq",
  title_arabic: "في السوق",
  description: "Shopping vocabulary",
  duration_minutes: 15,
  cefr_target: "A2",
  approach: "task-based",
  icon: "🛍️",
  vocabulary: [
    { word_arabic: "سوق", word_english: "market" },
    { word_arabic: "سعر", word_english: "price" },
  ],
  ...over,
});

const approvalArgs = { messageId: MESSAGE, sessionId: SESSION };

describe("publishing a lesson", () => {
  it("creates it with the words it teaches", async () => {
    const harness = render();

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: aLessonDraft(),
      dialectModule: "Gulf",
    });

    const [lesson] = harness.backend.db.rows("lessons");
    expect(lesson).toMatchObject({
      stage_id: STAGE,
      title: "At the souq",
      title_arabic: "في السوق",
      cefr_target: "A2",
      dialect_module: "Gulf",
    });
    // A lesson with no vocabulary is a title and a description; the words are
    // the lesson.
    expect(
      harness.backend.db.rows("vocabulary_words").map((word) => word.word_arabic),
    ).toEqual(["سوق", "سعر"]);
  });

  it("numbers it after the last lesson in the stage", async () => {
    const harness = render((backend) =>
      backend.db.seed("lessons", [
        aLesson({ id: lessonId(0), stage_id: STAGE, lesson_number: 1 }),
        aLesson({ id: lessonId(1), stage_id: STAGE, lesson_number: 4 }),
      ]),
    );

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: aLessonDraft(),
    });

    // Reusing a number would put two lessons at the same point in a sequence
    // that a learner walks in order.
    const created = harness.backend.db
      .rows("lessons")
      .find((lesson) => lesson.title === "At the souq");
    expect(created).toMatchObject({ lesson_number: 5, display_order: 5 });
  });

  it("starts a stage's first lesson at one", async () => {
    const harness = render();

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: aLessonDraft(),
    });

    expect(harness.backend.db.rows("lessons")[0]).toMatchObject({ lesson_number: 1 });
  });

  it("keeps the words in the order the model taught them", async () => {
    const harness = render();

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: aLessonDraft(),
    });

    // The draft's order is pedagogical — it builds — and shuffling it would
    // teach the plural before the singular.
    expect(
      harness.backend.db.rows("vocabulary_words").map((word) => word.display_order),
    ).toEqual([1, 2]);
  });

  it("fills in the defaults a lesson row needs", async () => {
    const harness = render();

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: { title: "Bare draft" },
    });

    const [lesson] = harness.backend.db.rows("lessons");
    // The curriculum grid renders an icon and a gradient for every card; a
    // draft that omitted them would publish as a blank tile.
    expect(lesson).toMatchObject({
      icon: "📚",
      gradient: "bg-gradient-green",
      dialect_module: "Gulf",
      title_arabic: null,
      description: null,
    });
  });

  it("publishes a lesson with no vocabulary of its own", async () => {
    const harness = render();

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: aLessonDraft({ vocabulary: [] }),
    });

    // Vocabulary is often approved as a second step from the same chat.
    expect(harness.backend.db.rows("lessons")).toHaveLength(1);
    expect(harness.backend.db.rows("vocabulary_words")).toEqual([]);
  });

  it("records who approved it and from which message", async () => {
    const harness = render();

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: aLessonDraft(),
    });

    // The audit trail: months later, "why does this lesson say that" resolves
    // to a conversation and a person.
    expect(harness.backend.db.rows("curriculum_chat_approvals")[0]).toMatchObject({
      message_id: MESSAGE,
      session_id: SESSION,
      approval_type: "lesson",
      approved_by: TEST_USER_ID,
    });
  });

  it("publishes even when the audit row cannot be written", async () => {
    const harness = render((backend) =>
      backend.db.failInserts("curriculum_chat_approvals", 500, { message: "boom" }),
    );

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: aLessonDraft(),
    });

    // Deliberately non-fatal. The lesson and its words are already committed,
    // and failing here would leave them published with the admin told the
    // approval failed.
    expect(harness.backend.db.rows("lessons")).toHaveLength(1);
  });

  it("adds the lesson to the coverage ledger", async () => {
    const harness = render();

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: aLessonDraft(),
      dialectModule: "Egyptian",
    });

    // The coverage planner reads this to stop the next generation repeating
    // what was just published.
    await waitFor(() =>
      expect(harness.backend.lastCallTo("extract-concepts")?.body).toMatchObject({
        content_type: "lesson",
        dialect: "Egyptian",
        cefr_level: "A2",
        stage_id: STAGE,
      }),
    );
  });

  it("publishes even when the ledger call fails", async () => {
    const harness = render((backend) => backend.stubFunctionFailure("extract-concepts", 500));

    await harness.result.current.approveLesson.mutateAsync({
      ...approvalArgs,
      stageId: STAGE,
      lessonData: aLessonDraft(),
    });

    // Fire-and-forget: the ledger makes the *next* lesson better, and losing
    // that is not worth failing this one.
    expect(harness.backend.db.rows("lessons")).toHaveLength(1);
  });

  it("leaves a lesson with no words behind when the vocabulary insert fails", async () => {
    const harness = render((backend) =>
      backend.db.failInserts("vocabulary_words", 500, { message: "boom" }),
    );

    await expect(
      harness.result.current.approveLesson.mutateAsync({
        ...approvalArgs,
        stageId: STAGE,
        lessonData: aLessonDraft(),
      }),
    ).rejects.toBeTruthy();

    // Pinned. The two inserts are not a transaction, so a failure on the second
    // leaves the lesson published and empty — visible in the curriculum,
    // holding the next lesson number, teaching nothing. The admin is told the
    // approval failed and the obvious retry creates a second lesson beside the
    // first.
    expect(harness.backend.db.rows("lessons")).toHaveLength(1);
    expect(harness.backend.db.rows("vocabulary_words")).toEqual([]);
  });

  it("reports a refused lesson insert", async () => {
    const harness = render((backend) =>
      backend.db.failInserts("lessons", 403, { message: "denied" }),
    );

    await expect(
      harness.result.current.approveLesson.mutateAsync({
        ...approvalArgs,
        stageId: STAGE,
        lessonData: aLessonDraft(),
      }),
    ).rejects.toBeTruthy();
  });
});

describe("adding vocabulary to an existing lesson", () => {
  const words = [
    { word_arabic: "خضار", word_english: "vegetables" },
    { word_arabic: "فواكه", word_english: "fruit" },
  ];

  it("appends after the words already there", async () => {
    const harness = render((backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0), stage_id: STAGE })]);
      backend.db.seed("vocabulary_words", [
        aVocabularyWord({ id: wordId(0), lesson_id: lessonId(0), display_order: 3 }),
      ]);
    });

    await harness.result.current.approveVocabulary.mutateAsync({
      ...approvalArgs,
      lessonId: lessonId(0),
      words,
    });

    // Continuing the sequence rather than restarting it, so a second batch does
    // not interleave with the first when the lesson is rendered in order.
    const added = harness.backend.db
      .rows("vocabulary_words")
      .filter((word) => word.word_arabic !== "كلمة");
    expect(added.map((word) => word.display_order)).toEqual([4, 5]);
  });

  it("starts at one in an empty lesson", async () => {
    const harness = render((backend) =>
      backend.db.seed("lessons", [aLesson({ id: lessonId(0), stage_id: STAGE })]),
    );

    await harness.result.current.approveVocabulary.mutateAsync({
      ...approvalArgs,
      lessonId: lessonId(0),
      words,
    });

    expect(
      harness.backend.db.rows("vocabulary_words").map((word) => word.display_order),
    ).toEqual([1, 2]);
  });

  it("records the approval against the lesson", async () => {
    const harness = render((backend) =>
      backend.db.seed("lessons", [aLesson({ id: lessonId(0), stage_id: STAGE })]),
    );

    await harness.result.current.approveVocabulary.mutateAsync({
      ...approvalArgs,
      lessonId: lessonId(0),
      words,
    });

    expect(harness.backend.db.rows("curriculum_chat_approvals")[0]).toMatchObject({
      approval_type: "vocabulary",
      target_lesson_id: lessonId(0),
    });
  });

  it("reports a refused insert", async () => {
    const harness = render((backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0), stage_id: STAGE })]);
      backend.db.failInserts("vocabulary_words", 403, { message: "denied" });
    });

    await expect(
      harness.result.current.approveVocabulary.mutateAsync({
        ...approvalArgs,
        lessonId: lessonId(0),
        words,
      }),
    ).rejects.toBeTruthy();
  });
});

describe("publishing the other content types", () => {
  it("publishes grammar exercises with their answers", async () => {
    const harness = render();

    await harness.result.current.approveGrammarExercises.mutateAsync({
      ...approvalArgs,
      data: {
        category: "negation",
        difficulty: "intermediate",
        exercises: [
          {
            question_arabic: "___ أروح",
            question_english: "I am not going",
            grammar_point: "negation with ما",
            choices: ["ما", "لا", "لم"],
            correct_index: 0,
            explanation: "Gulf negation uses ما with the imperfect.",
          },
        ],
      },
    });

    const [exercise] = harness.backend.db.rows("grammar_exercises");
    // The index is what the drill scores against, and the explanation is what
    // the learner reads when they get it wrong — an exercise without one is a
    // quiz rather than a lesson.
    expect(exercise).toMatchObject({
      category: "negation",
      difficulty: "intermediate",
      correct_index: 0,
      explanation: "Gulf negation uses ما with the imperfect.",
      status: "published",
      created_by: TEST_USER_ID,
      session_id: SESSION,
    });
  });

  it("falls back to sensible defaults for an under-specified grammar draft", async () => {
    const harness = render();

    await harness.result.current.approveGrammarExercises.mutateAsync({
      ...approvalArgs,
      data: {
        exercises: [
          {
            question_arabic: "س",
            question_english: "q",
            choices: ["a", "b"],
            correct_index: 1,
          },
        ],
      },
    });

    // A null category would leave the exercise out of every category-filtered
    // drill, which is every drill.
    expect(harness.backend.db.rows("grammar_exercises")[0]).toMatchObject({
      category: "verb-conjugation",
      difficulty: "beginner",
      grammar_point: "",
      explanation: "",
    });
  });

  it("publishes listening exercises with their prompts", async () => {
    const harness = render();

    await harness.result.current.approveListeningExercises.mutateAsync({
      ...approvalArgs,
      data: {
        mode: "comprehension",
        difficulty: "advanced",
        exercises: [
          {
            // audio_text is the English clip that gets spoken;
            // audio_text_english is its dialect gloss, name notwithstanding.
            audio_text: "I went to the market yesterday",
            audio_text_english: "رحت السوق أمس",
            options: [{ question: "Where did they go?" }],
            hint: "Listen for the place",
          },
        ],
      },
    });

    expect(harness.backend.db.rows("listening_exercises")[0]).toMatchObject({
      mode: "comprehension",
      difficulty: "advanced",
      audio_text: "I went to the market yesterday",
      hint: "Listen for the place",
      status: "published",
    });
  });

  it("stores an empty question list rather than nothing", async () => {
    const harness = render();

    await harness.result.current.approveListeningExercises.mutateAsync({
      ...approvalArgs,
      data: {
        exercises: [{ audio_text: "good", audio_text_english: "زين" }],
      },
    });

    // Dictation exercises have no questions at all; the player maps over the
    // column, so null would break the mode that needs it least.
    expect(harness.backend.db.rows("listening_exercises")[0]).toMatchObject({
      mode: "dictation",
      questions: [],
      hint: null,
    });
  });

  it("publishes a reading passage with its glossary and questions", async () => {
    const harness = render();

    await harness.result.current.approveReadingPassage.mutateAsync({
      ...approvalArgs,
      data: {
        difficulty: "intermediate",
        dialect: "Yemeni",
        passage: {
          title: "في السوق",
          title_english: "At the market",
          passage: "رحت السوق أمس",
          passage_english: "I went to the market yesterday",
          vocabulary: [{ word: "سوق" }],
          questions: [{ q: "Where?" }],
          cultural_note: "Souqs open after asr.",
        },
      },
    });

    // The Arabic-era builder payload is crosswired into the flipped columns:
    // `title`/`passage` carry the English the reader treats as the passage,
    // the Arabic becomes its scaffold.
    const [passage] = harness.backend.db.rows("reading_passages");
    expect(passage).toMatchObject({
      title: "At the market",
      title_arabic: "في السوق",
      passage: "I went to the market yesterday",
      passage_arabic: "رحت السوق أمس",
      difficulty: "intermediate",
      cultural_note: "Souqs open after asr.",
      status: "published",
    });
    await waitFor(() =>
      expect(harness.backend.lastCallTo("extract-concepts")?.body).toMatchObject({
        content_type: "reading",
        dialect: "Yemeni",
      }),
    );
  });

  it("passes an already-flipped passage payload straight through", async () => {
    const harness = render();

    // A payload with no *_english fields is the flipped shape: English in
    // title/passage, the scaffold in the _arabic fields. It must not be
    // crosswired a second time.
    await harness.result.current.approveReadingPassage.mutateAsync({
      ...approvalArgs,
      data: {
        difficulty: "beginner",
        passage: {
          title: "At the market",
          title_arabic: "في السوق",
          passage: "I went to the market yesterday",
          passage_arabic: "رحت السوق أمس",
          lines: [{ english: "I went to the market yesterday", arabic: "رحت السوق أمس" }],
          vocabulary: [],
          questions: [],
        },
      },
    });

    expect(harness.backend.db.rows("reading_passages")[0]).toMatchObject({
      title: "At the market",
      title_arabic: "في السوق",
      passage: "I went to the market yesterday",
      passage_arabic: "رحت السوق أمس",
      lines: [{ english: "I went to the market yesterday", arabic: "رحت السوق أمس" }],
    });
  });

  it("publishes a daily challenge", async () => {
    const harness = render();

    await harness.result.current.approveDailyChallenge.mutateAsync({
      ...approvalArgs,
      data: {
        challenge_type: "vocabulary",
        title: "Souq words",
        title_arabic: "كلمات السوق",
        difficulty: "beginner",
        questions: [{ q: "سوق" }],
      },
    });

    expect(harness.backend.db.rows("daily_challenges")[0]).toMatchObject({
      challenge_type: "vocabulary",
      title: "Souq words",
      status: "published",
      created_by: TEST_USER_ID,
    });
  });

  it("publishes a conversation scenario with the prompt that drives it", async () => {
    const harness = render();

    await harness.result.current.approveConversationScenario.mutateAsync({
      ...approvalArgs,
      data: {
        dialect: "Gulf",
        scenario: {
          title: "Ordering coffee",
          title_arabic: "طلب قهوة",
          description: "Order at a café",
          system_prompt: "You are a barista in Kuwait. Speak Gulf Arabic only.",
          difficulty: "Beginner",
          icon_name: "Coffee",
          example_exchanges: [{ user: "مرحبا" }],
        },
      },
    });

    // The system prompt *is* the scenario — everything else is a label on it,
    // and a scenario published without one would produce a generic chatbot.
    expect(harness.backend.db.rows("conversation_scenarios")[0]).toMatchObject({
      title: "Ordering coffee",
      system_prompt: "You are a barista in Kuwait. Speak Gulf Arabic only.",
      icon_name: "Coffee",
      status: "published",
    });
  });

  it("gives a scenario a default icon and difficulty", async () => {
    const harness = render();

    await harness.result.current.approveConversationScenario.mutateAsync({
      ...approvalArgs,
      data: {
        scenario: {
          title: "Bare",
          title_arabic: "بسيط",
          system_prompt: "Speak Gulf Arabic.",
        },
      },
    });

    expect(harness.backend.db.rows("conversation_scenarios")[0]).toMatchObject({
      difficulty: "Beginner",
      icon_name: "MessageCircle",
      description: "",
      example_exchanges: [],
    });
  });

  it("publishes a vocabulary game set", async () => {
    const harness = render();

    await harness.result.current.approveGameSet.mutateAsync({
      ...approvalArgs,
      data: {
        game_type: "matching",
        title: "Souq matching",
        difficulty: "beginner",
        word_pairs: [{ arabic: "سوق", english: "market" }],
      },
    });

    expect(harness.backend.db.rows("vocab_game_sets")[0]).toMatchObject({
      game_type: "matching",
      title: "Souq matching",
      word_pairs: [{ arabic: "سوق", english: "market" }],
      status: "published",
    });
  });

  it("reports a refused publish", async () => {
    const harness = render((backend) =>
      backend.db.failInserts("vocab_game_sets", 403, { message: "denied" }),
    );

    // Publishing is the irreversible step; an approval that silently failed
    // would leave the admin believing the content is live.
    await expect(
      harness.result.current.approveGameSet.mutateAsync({
        ...approvalArgs,
        data: { title: "Souq matching", word_pairs: [] },
      }),
    ).rejects.toBeTruthy();
  });
});

describe("who is allowed to publish", () => {
  it("refuses every approval for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useCurriculumApproval(), {
      persona: "anonymous",
    });
    cleanup = harness.cleanup;

    // `created_by` is what makes a published lesson traceable to a person, and
    // there is no person here.
    await expect(
      harness.result.current.approveLesson.mutateAsync({
        ...approvalArgs,
        stageId: STAGE,
        lessonData: aLessonDraft(),
      }),
    ).rejects.toThrow("Not authenticated");
    await expect(
      harness.result.current.approveGameSet.mutateAsync({
        ...approvalArgs,
        data: { title: "x", word_pairs: [] },
      }),
    ).rejects.toThrow("Not authenticated");
    expect(harness.backend.db.rows("lessons")).toEqual([]);
  });
});
