import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aStage, stageId } from "@/test/support/factories";
import { useLessonImport } from "./useLessonImport";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Turning a parsed lesson plan into rows.
 *
 * The other half of the spreadsheet import: `parseLessonXlsx` reads the file,
 * this writes it. Everything an author put in the file either lands here or is
 * lost, and nothing downstream can tell the difference — the lesson appears in
 * the admin list either way.
 *
 * The insert used to drop every lesson-plan column, so a designed lesson
 * arrived as a bare vocabulary list; that has been fixed for the lesson and is
 * covered here so it cannot regress. The same class of drop is still present
 * for the words themselves, which is recorded below.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const aWord = (over: Record<string, unknown> = {}) => ({
  number: 1,
  arabic: "باب",
  transliteration: "baab",
  english: "door",
  category: "objects",
  imageScene: "a wooden door",
  teachingNote: "emphatic b",
  ...over,
});

const aPlan = (over: Record<string, unknown> = {}) => ({
  stageId: stageId(0),
  lessonNumber: 3,
  title: "Objects — The World Around You",
  description: "Immersion-first",
  durationMinutes: 15,
  cefrTarget: "A1",
  approach: "Immersion-first",
  unlockCondition: "Finish Lesson 2",
  vocabulary: [aWord()],
  lessonSequence: [{ Step: "Warm-up" }],
  imageScenes: [{ Word: "باب" }],
  flashcardSpec: [{ Front: "باب" }],
  realWorldPrompts: [{ Prompt: "Name three objects" }],
  designRationale: [{ principle: "Concrete first" }],
  soundSpotlight: [{ sound: "ق" }],
  ...over,
});

async function importPlan(plan: Record<string, unknown>, seed?: (b: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(() => useLessonImport(), {
    persona: "admin",
    seed: (backend) => {
      backend.db.seed("curriculum_stages", [aStage({ id: stageId(0) })]);
      backend.db.seed("lessons", []);
      backend.db.seed("vocabulary_words", []);
      seed?.(backend);
    },
  });
  cleanup = harness.cleanup;

  await act(async () => {
    await harness.result.current.mutateAsync(plan as never);
  });

  return harness.backend;
}

describe("the lesson row", () => {
  it("writes the overview fields", async () => {
    const backend = await importPlan(aPlan());

    const lesson = backend.db.rows("lessons")[0];
    expect(lesson).toMatchObject({
      title: "Objects — The World Around You",
      lesson_number: 3,
      duration_minutes: 15,
      cefr_target: "A1",
      approach: "Immersion-first",
    });
  });

  it("writes every authored lesson-plan section", async () => {
    const backend = await importPlan(aPlan());

    // All six were parsed correctly and dropped at insert for a long time, so a
    // designed lesson reached the learner as a bare word list. Two of them —
    // sound_spotlight and lesson_sequence — are rendered on the first card of
    // the lesson; the rest is authoring metadata.
    const lesson = backend.db.rows("lessons")[0];
    expect(lesson.unlock_condition).toBe("Finish Lesson 2");
    expect(lesson.lesson_sequence).toHaveLength(1);
    expect(lesson.image_scenes).toHaveLength(1);
    expect(lesson.flashcard_spec).toHaveLength(1);
    expect(lesson.real_world_prompts).toHaveLength(1);
    expect(lesson.design_rationale).toHaveLength(1);
    expect(lesson.sound_spotlight).toHaveLength(1);
  });

  it("stores an empty array rather than null for a section the file omitted", async () => {
    const backend = await importPlan(
      aPlan({ lessonSequence: undefined, soundSpotlight: undefined }),
    );

    // The renderers iterate these; null would throw where an empty array
    // renders nothing.
    const lesson = backend.db.rows("lessons")[0];
    expect(lesson.lesson_sequence).toEqual([]);
    expect(lesson.sound_spotlight).toEqual([]);
  });

  it("arrives as a draft, not published", async () => {
    const backend = await importPlan(aPlan());

    // An import is a first draft. Publishing on upload would put an unreviewed
    // lesson in front of learners the moment a file was picked.
    expect(backend.db.rows("lessons")[0].status).toBe("draft");
  });

  it("orders the lesson by its number", async () => {
    const backend = await importPlan(aPlan({ lessonNumber: 7 }));

    expect(Number(backend.db.rows("lessons")[0].display_order)).toBe(7);
  });

  it("defaults the dialect to Gulf when the plan does not say", async () => {
    const backend = await importPlan(aPlan());

    // Every dialect-scoped query filters on this; a null would make the lesson
    // invisible in all three modules.
    expect(backend.db.rows("lessons")[0].dialect_module).toBe("Gulf");
  });

  it("honours an explicit dialect", async () => {
    const backend = await importPlan(aPlan({ dialectModule: "Egyptian" }));

    expect(backend.db.rows("lessons")[0].dialect_module).toBe("Egyptian");
  });

  it("stores an absent optional field as null", async () => {
    const backend = await importPlan(
      aPlan({ titleArabic: undefined, description: undefined, cefrTarget: "" }),
    );

    const lesson = backend.db.rows("lessons")[0];
    expect(lesson.title_arabic).toBeNull();
    expect(lesson.description).toBeNull();
    expect(lesson.cefr_target).toBeNull();
  });
});

describe("the vocabulary rows", () => {
  it("links each word to the lesson that was just created", async () => {
    const backend = await importPlan(
      aPlan({ vocabulary: [aWord(), aWord({ number: 2, arabic: "كتاب", english: "book" })] }),
    );

    const lessonId = backend.db.rows("lessons")[0].id;
    const words = backend.db.rows("vocabulary_words");
    expect(words).toHaveLength(2);
    expect(words.every((word) => word.lesson_id === lessonId)).toBe(true);
  });

  it("keeps the order the author wrote them in", async () => {
    const backend = await importPlan(
      aPlan({
        vocabulary: [
          aWord({ arabic: "باب" }),
          aWord({ number: 2, arabic: "كتاب" }),
          aWord({ number: 3, arabic: "قلم" }),
        ],
      }),
    );

    // The lesson walks the words in display order; shuffling them breaks a
    // sequence the author designed around.
    const words = backend.db.rows("vocabulary_words");
    expect(words.map((word) => word.display_order)).toEqual([0, 1, 2]);
    expect(words.map((word) => word.word_arabic)).toEqual(["باب", "كتاب", "قلم"]);
  });

  it("gives the words the lesson's dialect", async () => {
    const backend = await importPlan(aPlan({ dialectModule: "Yemeni" }));

    // A word in a different module from its lesson is unreachable — the lesson
    // shows in Yemeni and the word only in Gulf.
    expect(backend.db.rows("vocabulary_words")[0].dialect_module).toBe("Yemeni");
  });

  it("creates a lesson with no words when the file had none", async () => {
    const backend = await importPlan(aPlan({ vocabulary: [] }));

    expect(backend.db.rows("lessons")).toHaveLength(1);
    expect(backend.db.rows("vocabulary_words")).toEqual([]);
  });

  it("drops the transliteration, category, note and scene the author wrote", async () => {
    const backend = await importPlan(aPlan());

    // Recording current behaviour. parseLessonXlsx reads all four of these off
    // the vocabulary sheet, and vocabulary_words has a column for each of them
    // — transliteration, category, teaching_note and image_scene_description,
    // added by the curriculum restructure. The insert here writes none of them,
    // so an author's pronunciation guides and teaching notes are parsed,
    // previewed on the import screen, and then thrown away.
    //
    // This is the same class of drop that used to affect the lesson-plan
    // sections above, which have since been fixed. This test fails once the
    // words are too.
    const word = backend.db.rows("vocabulary_words")[0];
    expect(word.transliteration).toBeUndefined();
    expect(word.category).toBeUndefined();
    expect(word.teaching_note).toBeUndefined();
    expect(word.image_scene_description).toBeUndefined();
  });
});

describe("when the import fails", () => {
  it("raises rather than reporting success", async () => {
    const harness = renderHookWithProviders(() => useLessonImport(), {
      persona: "admin",
      seed: (backend) => {
        backend.db.seed("curriculum_stages", [aStage({ id: stageId(0) })]);
        backend.db.seed("lessons", []);
        backend.db.failWrites("lessons", 403);
      },
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await expect(harness.result.current.mutateAsync(aPlan() as never)).rejects.toThrow();
    });
  });

  it("leaves the lesson behind when the words fail", async () => {
    const harness = renderHookWithProviders(() => useLessonImport(), {
      persona: "admin",
      seed: (backend) => {
        backend.db.seed("curriculum_stages", [aStage({ id: stageId(0) })]);
        backend.db.seed("lessons", []);
        backend.db.seed("vocabulary_words", []);
        backend.db.failWrites("vocabulary_words", 403);
      },
    });
    cleanup = harness.cleanup;

    // Asserted inside `act` rather than around it: letting the rejection
    // escape the act scope leaves React's internal queue flagged, and the next
    // test in the file renders a tree whose result is null.
    await act(async () => {
      await expect(harness.result.current.mutateAsync(aPlan() as never)).rejects.toThrow();
    });

    // Recording current behaviour. The two inserts are not in a transaction —
    // PostgREST has no way to express one from the client — so a failure on the
    // words leaves an empty lesson row behind. The admin sees "Import failed"
    // and re-uploads, which creates a second lesson rather than completing the
    // first. Worth knowing before someone wonders why the list has duplicates.
    await waitFor(() => expect(harness.backend.db.rows("lessons")).toHaveLength(1));
    expect(harness.backend.db.rows("vocabulary_words")).toEqual([]);
  });
});
