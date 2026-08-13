import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aLesson, aTopic, aVocabularyWord, lessonId, topicId, wordId } from "@/test/support/factories";
import { useTopic } from "./useTopic";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * A lesson with its words *and* its authored lesson plan.
 *
 * This is the wider sibling of `useLesson`: same two-table lookup, but it also
 * reads the three JSONB columns the spreadsheet importer fills — the sound
 * spotlight, the real-world prompts, and the sequence a teacher wrote for
 * running the lesson.
 *
 * Those columns have existed since the curriculum restructure and
 * `parseLessonXlsx` has always produced them, but for a long time the importer
 * dropped them at insert and nothing selected them, so a lesson somebody had
 * designed reached the learner as a bare vocabulary list. Lessons imported
 * before that was fixed still have nothing there, which is why every one of
 * these has to degrade to an empty array rather than to undefined.
 *
 * The data originates in a spreadsheet, so it is only as well-formed as
 * whoever authored the sheet — hence the coercion, and hence these tests.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(id: string | undefined, seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(() => useTopic(id), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

const A_SPOTLIGHT = [{ sound: "ق", example: "قلم", explanation: "A hard k from the throat" }];
const A_PROMPT = [{ prompt: "Order a coffee", notes: "Use the phrases from section 2" }];
const A_SEQUENCE = [{ step: "1", activity: "Warm-up" }];

describe("a lesson with a plan", () => {
  it("returns the words and the authored sections together", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [
        aLesson({
          id: lessonId(0),
          title: "At the Café",
          sound_spotlight: A_SPOTLIGHT,
          real_world_prompts: A_PROMPT,
          lesson_sequence: A_SEQUENCE,
        }),
      ]);
      backend.db.seed("vocabulary_words", [
        aVocabularyWord({ id: wordId(1), lesson_id: lessonId(0), display_order: 1 }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The whole reason this hook is wider than useLesson: a designed lesson
    // should arrive designed, not as the vocabulary list that survived import.
    expect(result.current.data?.name).toBe("At the Café");
    expect(result.current.data?.words).toHaveLength(1);
    expect(result.current.data?.soundSpotlight).toEqual(A_SPOTLIGHT);
    expect(result.current.data?.realWorldPrompts).toEqual(A_PROMPT);
    expect(result.current.data?.lessonSequence).toEqual(A_SEQUENCE);
  });

  it("returns the words in teaching order", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0) })]);
      backend.db.seed("vocabulary_words", [
        aVocabularyWord({ id: wordId(2), lesson_id: lessonId(0), display_order: 2 }),
        aVocabularyWord({ id: wordId(1), lesson_id: lessonId(0), display_order: 1 }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.words.map((word) => word.id)).toEqual([wordId(1), wordId(2)]);
  });

  it("gives an empty plan to a lesson imported before the columns were filled", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [
        aLesson({
          id: lessonId(0),
          sound_spotlight: null,
          real_world_prompts: null,
          lesson_sequence: null,
        }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Empty arrays, not undefined: every renderer omits an empty section, and a
    // missing one would throw on `.length` in the middle of a lesson.
    expect(result.current.data?.soundSpotlight).toEqual([]);
    expect(result.current.data?.realWorldPrompts).toEqual([]);
    expect(result.current.data?.lessonSequence).toEqual([]);
  });
});

describe("a plan the spreadsheet mangled", () => {
  it("ignores a section that is not a list", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [
        aLesson({ id: lessonId(0), sound_spotlight: { sound: "ق" } }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A single object where a list was expected comes from a sheet with one
    // row and no header, and mapping over it would throw during render.
    expect(result.current.data?.soundSpotlight).toEqual([]);
  });

  it("drops entries that are not rows", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [
        aLesson({
          id: lessonId(0),
          real_world_prompts: [{ prompt: "Order a coffee" }, "just a string", null, ["a", "b"]],
        }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Stray cells below the table are the usual cause. Keeping the good rows is
    // better than discarding the section over one of them.
    expect(result.current.data?.realWorldPrompts).toEqual([{ prompt: "Order a coffee" }]);
  });

  it("keeps a partially filled entry rather than the whole section", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0), sound_spotlight: [{ sound: "ق" }] })]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // An author who filled the sound column and left the explanation blank
    // still wrote something worth showing.
    expect(result.current.data?.soundSpotlight).toEqual([{ sound: "ق" }]);
  });
});

describe("a legacy topic id", () => {
  it("falls back to the topics table with no plan", async () => {
    const { result } = render(topicId(0), (backend) => {
      backend.db.seed("topics", [aTopic({ id: topicId(0), name: "Food", name_arabic: "طعام" })]);
      backend.db.seed("vocabulary_words", [
        aVocabularyWord({ id: wordId(1), topic_id: topicId(0) }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Topics predate the lesson plan entirely; the empty sections are what let
    // one component render either kind.
    expect(result.current.data?.name).toBe("Food");
    expect(result.current.data?.words.map((word) => word.id)).toEqual([wordId(1)]);
    expect(result.current.data?.soundSpotlight).toEqual([]);
  });

  it("joins its words on the topic column", async () => {
    const { result } = render(topicId(0), (backend) => {
      backend.db.seed("topics", [aTopic({ id: topicId(0) })]);
      backend.db.seed("vocabulary_words", [
        aVocabularyWord({ id: wordId(1), topic_id: topicId(0) }),
        aVocabularyWord({ id: wordId(2), lesson_id: topicId(0) }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.words.map((word) => word.id)).toEqual([wordId(1)]);
  });
});

describe("when there is nothing to load", () => {
  it("reports an error for an id neither table knows", async () => {
    const { result } = render(lessonId(9));

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("does not query without an id", async () => {
    const { result, backend } = render(undefined);

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(backend.db.reads.filter((read) => ["lessons", "topics"].includes(read.table))).toEqual(
      [],
    );
  });

  it("surfaces a failed word fetch rather than a wordless lesson", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0) })]);
      backend.db.failAlways("vocabulary_words", 500, { message: "boom" });
    });

    // Rendering the lesson with no words would tell the learner it teaches
    // nothing, which is a content problem rather than the outage it is.
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("falls back to topics when the lesson lookup itself fails", async () => {
    const { result } = render(topicId(0), (backend) => {
      backend.db.failAlways("lessons", 500, { message: "boom" });
      backend.db.seed("topics", [aTopic({ id: topicId(0), name: "Food" })]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Pinned. The lessons lookup discards its error and only checks whether a
    // row came back, so an outage on that table is indistinguishable from a
    // miss. Here it degrades gracefully; for an id that *is* a lesson it would
    // silently fall through to topics, miss there too, and report the id as
    // not found rather than as a failure.
    expect(result.current.data?.name).toBe("Food");
  });
});
