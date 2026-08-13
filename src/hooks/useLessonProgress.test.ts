import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { aLesson, aLessonProgress, daysAgo, lessonId, stageId } from "@/test/support/factories";
import { useAuth } from "./useAuth";
import {
  useLessonProgress,
  useLessonProgressFor,
  useResumableLesson,
  useUpsertLessonProgress,
} from "./useLessonProgress";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Where a learner is in each lesson.
 *
 * Until this existed the only trace of progress was one localStorage entry with
 * a seven-day life, so switching device meant starting the curriculum again.
 * That history is why the merge rules matter more than they look: every write
 * is a partial update to a shared row, and getting one wrong quietly rewrites
 * something the learner earned — a best score lowered by a worse attempt, a
 * finished lesson demoted to in-progress, a progress bar that shrinks when they
 * step back to review an earlier card.
 */

const LESSON = lessonId(0);
const OTHER = lessonId(1);

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-03-11T12:00:00Z"));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

function render<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(hook, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

/** Render the mutation and wait for the session it needs. */
async function renderUpsert(seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(
    () => ({ hook: useUpsertLessonProgress(), user: useAuth().user }),
    {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("lesson_progress", []);
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.user).toBeTruthy());
  return harness;
}

/** Run one update and return the resulting row. */
async function upsert(
  update: Record<string, unknown>,
  seed?: (backend: SupabaseBackend) => void,
) {
  const harness = await renderUpsert(seed);
  await act(async () => {
    await harness.result.current.hook.mutateAsync(update as never);
  });
  return harness.backend.db.rows("lesson_progress")[0];
}

describe("reading progress back", () => {
  it("returns every row for the learner", async () => {
    const { result } = render(() => useLessonProgress(), (backend) => {
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON }),
        aLessonProgress({ lesson_id: OTHER }),
        aLessonProgress({
          lesson_id: LESSON,
          user_id: "00000000-0000-4000-8000-000000000009",
        }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });

  it("returns one lesson's row", async () => {
    const { result } = render(() => useLessonProgressFor(LESSON), (backend) => {
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON, last_word_index: 4 }),
        aLessonProgress({ lesson_id: OTHER, last_word_index: 9 }),
      ]);
    });

    await waitFor(() => expect(result.current.data?.last_word_index).toBe(4));
  });

  it("returns null for a lesson never started", async () => {
    const { result } = render(() => useLessonProgressFor(LESSON), (backend) => {
      backend.db.seed("lesson_progress", []);
    });

    // Learn.tsx gates its resume on the query having *settled*, not on the row
    // being truthy — a null here is a normal state, not a missing answer.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("asks nothing without a lesson", async () => {
    const { result, backend } = render(() => useLessonProgressFor(undefined), (b) =>
      b.db.seed("lesson_progress", [aLessonProgress({ lesson_id: LESSON })]),
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(backend.db.readsOf("lesson_progress")).toHaveLength(0);
  });
});

describe("the lesson to offer resuming", () => {
  const seedResumable = (backend: SupabaseBackend) => {
    backend.db.seed("curriculum_stages", []);
    backend.db.seed("lessons", [
      aLesson({ id: LESSON, stage_id: stageId(0), title: "Greetings", dialect_module: "Gulf" }),
      aLesson({ id: OTHER, stage_id: stageId(0), title: "Cairo talk", dialect_module: "Egyptian" }),
    ]);
    backend.db.seed("lesson_progress", [
      aLessonProgress({
        lesson_id: LESSON,
        status: "in_progress",
        last_word_index: 3,
        words_seen: 4,
        words_total: 10,
        updated_at: daysAgo(1),
      }),
    ]);
  };

  it("offers an unfinished lesson with where to pick up", async () => {
    const { result } = render(() => useResumableLesson("Gulf"), seedResumable);

    await waitFor(() => expect(result.current.data?.lessonId).toBe(LESSON));
    // The title comes from an embed on lessons; without it the home card would
    // say "Lesson" and give the learner nothing to recognise.
    expect(result.current.data?.title).toBe("Greetings");
    expect(result.current.data?.lastWordIndex).toBe(3);
  });

  it("offers nothing from another dialect", async () => {
    const { result } = render(() => useResumableLesson("Egyptian"), seedResumable);

    // Switching module must not offer the lesson from the one just left.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("offers nothing when every lesson is finished", async () => {
    const { result } = render(() => useResumableLesson("Gulf"), (backend) => {
      seedResumable(backend);
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON, status: "completed" }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("offers the most recently touched lesson", async () => {
    const { result } = render(() => useResumableLesson("Gulf"), (backend) => {
      seedResumable(backend);
      backend.db.seed("lessons", [
        aLesson({ id: LESSON, stage_id: stageId(0), title: "Older", dialect_module: "Gulf" }),
        aLesson({ id: OTHER, stage_id: stageId(0), title: "Newer", dialect_module: "Gulf" }),
      ]);
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON, status: "in_progress", updated_at: daysAgo(9) }),
        aLessonProgress({ lesson_id: OTHER, status: "in_progress", updated_at: daysAgo(1) }),
      ]);
    });

    await waitFor(() => expect(result.current.data?.title).toBe("Newer"));
  });
});

describe("recording progress", () => {
  it("creates a row for a lesson opened for the first time", async () => {
    const row = await upsert({ lessonId: LESSON, lastWordIndex: 0, wordsSeen: 1, wordsTotal: 8 });

    expect(row.user_id).toBe(TEST_USER_ID);
    expect(row.lesson_id).toBe(LESSON);
    expect(row.status).toBe("in_progress");
    expect(Number(row.words_total)).toBe(8);
  });

  it("keeps the furthest point reached, not the current one", async () => {
    const row = await upsert({ lessonId: LESSON, wordsSeen: 2 }, (backend) => {
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON, words_seen: 7, words_total: 10 }),
      ]);
    });

    // Stepping back to review an earlier card must not shrink the progress bar
    // on the curriculum page.
    expect(Number(row.words_seen)).toBe(7);
  });

  it("advances the furthest point when the learner goes past it", async () => {
    const row = await upsert({ lessonId: LESSON, wordsSeen: 9 }, (backend) => {
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON, words_seen: 7, words_total: 10 }),
      ]);
    });

    expect(Number(row.words_seen)).toBe(9);
  });

  it("does not clobber the word count on a partial update", async () => {
    const row = await upsert({ lessonId: LESSON, lastWordIndex: 3 }, (backend) => {
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON, words_seen: 4, words_total: 10 }),
      ]);
    });

    // Every write is a whole-row upsert, so an omitted field would be written
    // as null and the percentage would divide by nothing.
    expect(Number(row.words_total)).toBe(10);
    expect(Number(row.words_seen)).toBe(4);
  });

  it("keeps the better of two scores", async () => {
    const row = await upsert({ lessonId: LESSON, score: 60, completed: true }, (backend) => {
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON, status: "completed", best_score: 100 }),
      ]);
    });

    // Practising a lesson again must not cost the learner a record they have
    // already set.
    expect(Number(row.best_score)).toBe(100);
  });

  it("takes a better score when there is one", async () => {
    const row = await upsert({ lessonId: LESSON, score: 95, completed: true }, (backend) => {
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON, status: "completed", best_score: 60 }),
      ]);
    });

    expect(Number(row.best_score)).toBe(95);
  });

  it("marks a finished lesson completed and stamps when", async () => {
    const row = await upsert({ lessonId: LESSON, completed: true, score: 80 });

    expect(row.status).toBe("completed");
    expect(row.completed_at).toBeTruthy();
  });

  it("resets a finished lesson to its first word", async () => {
    const row = await upsert({ lessonId: LESSON, completed: true, score: 80 }, (backend) => {
      backend.db.seed("lesson_progress", [
        aLessonProgress({ lesson_id: LESSON, last_word_index: 7 }),
      ]);
    });

    // Reopening a finished lesson is a decision to practise it again; resuming
    // at the last card would hand the learner a single word.
    expect(Number(row.last_word_index)).toBe(0);
  });

  it("does not demote a completed lesson when it is reopened", async () => {
    const row = await upsert({ lessonId: LESSON, lastWordIndex: 2, wordsSeen: 3 }, (backend) => {
      backend.db.seed("lesson_progress", [
        aLessonProgress({
          lesson_id: LESSON,
          status: "completed",
          best_score: 90,
          completed_at: daysAgo(2),
        }),
      ]);
    });

    // Otherwise practising a finished lesson would take the tick off it and put
    // it back in the resume card.
    expect(row.status).toBe("completed");
  });

  it("keeps one row per lesson", async () => {
    const harness = await renderUpsert();

    await act(async () => {
      await harness.result.current.hook.mutateAsync({ lessonId: LESSON, wordsSeen: 1 } as never);
      await harness.result.current.hook.mutateAsync({ lessonId: LESSON, wordsSeen: 2 } as never);
      await harness.result.current.hook.mutateAsync({ lessonId: OTHER, wordsSeen: 1 } as never);
    });

    // Upserted on (user_id, lesson_id); a second row would give one lesson two
    // conflicting positions and show it twice on the curriculum page.
    expect(harness.backend.db.rows("lesson_progress")).toHaveLength(2);
  });

  it("does nothing for a signed-out visitor rather than throwing", async () => {
    const harness = renderHookWithProviders(() => useUpsertLessonProgress(), {
      seed: (backend) => backend.db.seed("lesson_progress", []),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await harness.result.current.mutateAsync({ lessonId: LESSON, wordsSeen: 1 } as never);
    });

    // A signed-out learner can still take a lesson; bookkeeping just has
    // nowhere to go, and throwing would surface as a failure mid-lesson.
    expect(harness.backend.db.rows("lesson_progress")).toHaveLength(0);
  });

  it("logs a failed save rather than interrupting the lesson", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = await renderUpsert((backend) => {
      backend.db.failWrites("lesson_progress", 500);
    });

    await act(async () => {
      await expect(
        harness.result.current.hook.mutateAsync({ lessonId: LESSON, wordsSeen: 1 } as never),
      ).rejects.toThrow();
    });

    // This is bookkeeping alongside the lesson the learner is actually doing.
    // A toast, or an error boundary, would interrupt work over a saved
    // position.
    expect(warn).toHaveBeenCalledWith("Couldn't save lesson progress:", expect.anything());
  });
});
