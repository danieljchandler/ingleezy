import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aLesson,
  aTopic,
  aVocabularyWord,
  lessonId,
  topicId,
  wordId,
} from "@/test/support/factories";
import { useLesson } from "./useLesson";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * One lesson and the words it teaches.
 *
 * The id in the URL can name either of two things. Vocabulary was originally
 * organised into topics; lessons came later, with stages and a CEFR ladder, and
 * the old links never went away — bookmarks, a shared URL, a row in
 * `lesson_progress` recorded before the migration. So the hook tries `lessons`
 * first and falls back to `topics`, and the two carry the same information
 * under different column names.
 *
 * The words come from one table either way, joined on a different column
 * depending on which side answered. Getting that wrong does not error; it
 * returns a lesson with no words, which renders as an empty lesson rather than
 * as a fault.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(id: string | undefined, seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(() => useLesson(id), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

const aWord = (index: number, over: Record<string, unknown> = {}) =>
  aVocabularyWord({
    id: wordId(index),
    word_arabic: `كلمة${index}`,
    word_english: `word ${index}`,
    display_order: index,
    ...over,
  });

describe("a lesson", () => {
  it("returns it with its words in teaching order", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0), title: "Greetings" })]);
      backend.db.seed("vocabulary_words", [
        aWord(2, { lesson_id: lessonId(0) }),
        aWord(1, { lesson_id: lessonId(0) }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe("Greetings");
    // Curated order: the words build on each other, and shuffling them would
    // teach the plural before the singular.
    expect(result.current.data?.words.map((word) => word.id)).toEqual([wordId(1), wordId(2)]);
  });

  it("renames the lesson's columns to what the screen reads", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [
        aLesson({
          id: lessonId(0),
          title: "Greetings",
          title_arabic: "تحيات",
          icon: "📚",
          gradient: "bg-gradient-green",
          display_order: 3,
        }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // `title` on the row, `name` in the shape — the mapping exists so the same
    // component can render a lesson or a legacy topic without knowing which.
    expect(result.current.data).toMatchObject({
      name: "Greetings",
      name_arabic: "تحيات",
      icon: "📚",
      gradient: "bg-gradient-green",
      display_order: 3,
    });
  });

  it("gives an untitled lesson an empty Arabic name rather than null", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0), title_arabic: null })]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The heading renders it directly; null would print as nothing useful and
    // could reach a `.length` call.
    expect(result.current.data?.name_arabic).toBe("");
  });

  it("leaves out words belonging to another lesson", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0) })]);
      backend.db.seed("vocabulary_words", [
        aWord(1, { lesson_id: lessonId(0) }),
        aWord(2, { lesson_id: lessonId(1) }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.words.map((word) => word.id)).toEqual([wordId(1)]);
  });

  it("returns an empty word list for a lesson with no vocabulary yet", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0) })]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A lesson an admin has created but not filled is a real state on the way
    // to publishing one.
    expect(result.current.data?.words).toEqual([]);
  });
});

describe("a legacy topic id", () => {
  it("falls back to the topics table", async () => {
    const { result } = render(topicId(0), (backend) => {
      backend.db.seed("topics", [aTopic({ id: topicId(0), name: "Food" })]);
      backend.db.seed("vocabulary_words", [aWord(1, { topic_id: topicId(0) })]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Bookmarks and shared links from before the lessons migration still point
    // here, and they should still open something.
    expect(result.current.data?.name).toBe("Food");
    expect(result.current.data?.words.map((word) => word.id)).toEqual([wordId(1)]);
  });

  it("joins its words on the topic column, not the lesson one", async () => {
    const { result } = render(topicId(0), (backend) => {
      backend.db.seed("topics", [aTopic({ id: topicId(0) })]);
      backend.db.seed("vocabulary_words", [
        aWord(1, { topic_id: topicId(0) }),
        aWord(2, { lesson_id: topicId(0) }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Getting this wrong does not error — it returns an empty word list, which
    // renders as a lesson that teaches nothing.
    expect(result.current.data?.words.map((word) => word.id)).toEqual([wordId(1)]);
  });

  it("uses the topic's own name columns", async () => {
    const { result } = render(topicId(0), (backend) => {
      backend.db.seed("topics", [
        aTopic({ id: topicId(0), name: "Food", name_arabic: "طعام", icon: "🍽️" }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ name: "Food", name_arabic: "طعام", icon: "🍽️" });
  });

  it("prefers a lesson when both tables hold the id", async () => {
    const shared = lessonId(0);
    const { result } = render(shared, (backend) => {
      backend.db.seed("lessons", [aLesson({ id: shared, title: "From lessons" })]);
      backend.db.seed("topics", [aTopic({ id: shared, name: "From topics" })]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Lessons are the current model; the topic fallback exists only for ids
    // that no lesson claims.
    expect(result.current.data?.name).toBe("From lessons");
  });
});

describe("when the id names nothing", () => {
  it("reports an error rather than an empty lesson", async () => {
    const { result } = render(lessonId(9));

    // Both lookups miss, and `.single()` on the fallback is what turns that
    // into an error. An empty lesson would render as a lesson with no words,
    // which reads as broken content rather than a dead link.
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("does not query at all without an id", async () => {
    const { result, backend } = render(undefined);

    // `/learn` with no id is a real route that assembles its own batch, so a
    // failed lookup here would be noise on a screen that never wanted one.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(
      backend.db.reads.filter((read) => ["lessons", "topics"].includes(read.table)),
    ).toEqual([]);
  });
});

describe("when a read fails", () => {
  it("surfaces a failed word fetch rather than a wordless lesson", async () => {
    const { result } = render(lessonId(0), (backend) => {
      backend.db.seed("lessons", [aLesson({ id: lessonId(0) })]);
      backend.db.failAlways("vocabulary_words", 500, { message: "boom" });
    });

    // The lesson itself loaded, so the tempting thing is to render it with no
    // words — which tells the learner this lesson is empty when it is not.
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
