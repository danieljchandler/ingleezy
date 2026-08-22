import { describe, it, expect } from "vitest";
import {
  findNextUpLessonId,
  indexProgress,
  lessonPathState,
  mergeBestScore,
  planRowText,
  planRows,
  stageCompletion,
  suggestedStageId,
  type LessonProgressRow,
  type PathLesson,
} from "@/lib/lessonPath";

const lesson = (id: string, display_order: number): PathLesson => ({ id, display_order });

const progressRow = (
  lesson_id: string,
  over: Partial<LessonProgressRow> = {},
): LessonProgressRow => ({
  lesson_id,
  status: "in_progress",
  last_word_index: 0,
  words_seen: 0,
  words_total: 10,
  best_score: null,
  completed_at: null,
  ...over,
});

const LESSONS = [lesson("a", 1), lesson("b", 2), lesson("c", 3)];

describe("findNextUpLessonId", () => {
  it("points at the first lesson for a learner with no progress", () => {
    expect(findNextUpLessonId(LESSONS, indexProgress([]))).toBe("a");
  });

  it("prefers resuming something started over opening something new", () => {
    // 'a' is finished, 'b' is half-done: b, not c.
    const progress = indexProgress([
      progressRow("a", { status: "completed" }),
      progressRow("b", { words_seen: 4 }),
    ]);
    expect(findNextUpLessonId(LESSONS, progress)).toBe("b");
  });

  it("resumes an earlier started lesson rather than a later one", () => {
    const progress = indexProgress([
      progressRow("c", { words_seen: 1 }),
      progressRow("b", { words_seen: 1 }),
    ]);
    expect(findNextUpLessonId(LESSONS, progress)).toBe("b");
  });

  it("opens the next untouched lesson when nothing is mid-flight", () => {
    const progress = indexProgress([progressRow("a", { status: "completed" })]);
    expect(findNextUpLessonId(LESSONS, progress)).toBe("b");
  });

  it("returns null once everything is complete", () => {
    const progress = indexProgress(
      LESSONS.map((l) => progressRow(l.id, { status: "completed" })),
    );
    expect(findNextUpLessonId(LESSONS, progress)).toBeNull();
  });

  it("uses display order, not array order", () => {
    const shuffled = [lesson("c", 3), lesson("a", 1), lesson("b", 2)];
    expect(findNextUpLessonId(shuffled, indexProgress([]))).toBe("a");
  });

  it("does not mutate the input array", () => {
    const input = [lesson("c", 3), lesson("a", 1)];
    findNextUpLessonId(input, indexProgress([]));
    expect(input.map((l) => l.id)).toEqual(["c", "a"]);
  });

  it("handles an empty curriculum", () => {
    expect(findNextUpLessonId([], indexProgress([]))).toBeNull();
  });
});

describe("lessonPathState", () => {
  it("reports an untouched lesson as not started", () => {
    const state = lessonPathState(lesson("a", 1), indexProgress([]), null);
    expect(state.status).toBe("not_started");
    expect(state.percentComplete).toBe(0);
    expect(state.resumeIndex).toBe(0);
  });

  it("reports a completed lesson as 100% regardless of the word counters", () => {
    // A lesson finished early (or whose counters lag) must not read as partial.
    const progress = indexProgress([
      progressRow("a", { status: "completed", words_seen: 3, words_total: 10 }),
    ]);
    const state = lessonPathState(lesson("a", 1), progress, null);
    expect(state.status).toBe("completed");
    expect(state.percentComplete).toBe(100);
  });

  it("never rounds a started lesson down to zero", () => {
    // 1 of 200 rounds to 0%, which would read as untouched.
    const progress = indexProgress([progressRow("a", { words_seen: 1, words_total: 200 })]);
    expect(lessonPathState(lesson("a", 1), progress, null).percentComplete).toBe(1);
  });

  it("never rounds an unfinished lesson up to 100", () => {
    const progress = indexProgress([progressRow("a", { words_seen: 199, words_total: 200 })]);
    expect(lessonPathState(lesson("a", 1), progress, null).percentComplete).toBe(99);
  });

  it("tolerates a zero word total without dividing by zero", () => {
    const progress = indexProgress([progressRow("a", { words_total: 0, words_seen: 0 })]);
    expect(lessonPathState(lesson("a", 1), progress, null).percentComplete).toBe(0);
  });

  it("exposes a resume index only for an in-progress lesson", () => {
    const inProgress = indexProgress([progressRow("a", { last_word_index: 4, words_seen: 4 })]);
    expect(lessonPathState(lesson("a", 1), inProgress, null).resumeIndex).toBe(4);

    const done = indexProgress([
      progressRow("a", { status: "completed", last_word_index: 4 }),
    ]);
    expect(lessonPathState(lesson("a", 1), done, null).resumeIndex).toBe(0);
  });

  it("clamps a negative resume index", () => {
    const progress = indexProgress([progressRow("a", { last_word_index: -3 })]);
    expect(lessonPathState(lesson("a", 1), progress, null).resumeIndex).toBe(0);
  });

  it("flags exactly the next-up lesson", () => {
    const progress = indexProgress([]);
    const states = LESSONS.map((l) => lessonPathState(l, progress, "b"));
    expect(states.filter((s) => s.isNextUp)).toHaveLength(1);
    expect(states[1].isNextUp).toBe(true);
  });

  it("surfaces the best score", () => {
    const progress = indexProgress([
      progressRow("a", { status: "completed", best_score: 80 }),
    ]);
    expect(lessonPathState(lesson("a", 1), progress, null).bestScore).toBe(80);
  });
});

describe("stageCompletion", () => {
  it("counts only completed lessons", () => {
    const progress = indexProgress([
      progressRow("a", { status: "completed" }),
      progressRow("b", { words_seen: 5 }),
    ]);
    expect(stageCompletion(LESSONS, progress)).toEqual({
      completed: 1,
      total: 3,
      percent: 33,
    });
  });

  it("handles a stage with no lessons without dividing by zero", () => {
    expect(stageCompletion([], indexProgress([]))).toEqual({
      completed: 0,
      total: 0,
      percent: 0,
    });
  });
});

describe("mergeBestScore", () => {
  it("records the first attempt", () => {
    expect(mergeBestScore(null, 60)).toBe(60);
    expect(mergeBestScore(undefined, 60)).toBe(60);
  });

  it("keeps the higher score when a lesson is re-run", () => {
    // Practising a finished lesson must not erase a good result.
    expect(mergeBestScore(90, 40)).toBe(90);
  });

  it("takes the improvement when the re-run is better", () => {
    expect(mergeBestScore(40, 90)).toBe(90);
  });

  it("treats a zero previous score as a real score, not as absent", () => {
    expect(mergeBestScore(0, 0)).toBe(0);
  });
});

describe("planRowText", () => {
  it("prefers a prompt column as the headline", () => {
    const row = planRowText({
      "#": "1",
      Context: "At the shop",
      Prompt: "Ask for two kilos of tomatoes",
    });
    expect(row?.index).toBe("1");
    expect(row?.headline).toBe("Ask for two kilos of tomatoes");
    expect(row?.detail).toEqual(["At the shop"]);
  });

  it("falls back to the first content column when no key matches", () => {
    const row = planRowText({ Alpha: "first", Beta: "second" });
    expect(row?.headline).toBe("first");
    expect(row?.detail).toEqual(["second"]);
  });

  it("treats index-ish columns as the index, not as content", () => {
    for (const key of ["#", "No", "no.", "Number", "Order", "Step"]) {
      const row = planRowText({ [key]: "3", Task: "Say hello" });
      expect(row?.index).toBe("3");
      expect(row?.headline).toBe("Say hello");
    }
  });

  it("returns null for a blank row", () => {
    // Trailing empty rows are common in hand-maintained sheets; rendering them
    // produces empty cards.
    expect(planRowText({})).toBeNull();
    expect(planRowText({ Prompt: "   ", Context: "" })).toBeNull();
  });

  it("returns null when a row has only an index", () => {
    expect(planRowText({ "#": "4" })).toBeNull();
  });

  it("trims whitespace", () => {
    const row = planRowText({ Prompt: "  spaced  " });
    expect(row?.headline).toBe("spaced");
  });

  it("ignores non-string values without throwing", () => {
    const row = planRowText({ Prompt: "ok", Junk: undefined as unknown as string });
    expect(row?.headline).toBe("ok");
    expect(row?.detail).toEqual([]);
  });

  it("prioritises prompt over task when both exist", () => {
    const row = planRowText({ Task: "t", Prompt: "p" });
    expect(row?.headline).toBe("p");
  });
});

describe("planRows", () => {
  it("drops unrenderable rows", () => {
    expect(
      planRows([{ Prompt: "one" }, {}, { Prompt: "  " }, { Prompt: "two" }]),
    ).toHaveLength(2);
  });

  it("returns an empty array for an empty section", () => {
    expect(planRows([])).toEqual([]);
  });
});

describe("suggestedStageId", () => {
  const stage = (id: string, order: number, cefr: string | null) => ({
    id,
    display_order: order,
    cefr_level: cefr,
  });
  const STAGES = [
    stage("s1", 1, "Pre-A1 → A1"),
    stage("s2", 2, "A1 → A2"),
    stage("s3", 3, "A2 → B1"),
    stage("s4", 4, "B1 → B2"),
  ];

  it("routes a placed learner to the stage whose entry level they hold", () => {
    expect(suggestedStageId(STAGES, "A2")).toBe("s3");
    expect(suggestedStageId(STAGES, "B1")).toBe("s4");
  });

  it("caps at the highest stage for a level beyond every entry point", () => {
    // A C1 learner still gets the top stage rather than nothing.
    expect(suggestedStageId(STAGES, "C1")).toBe("s4");
  });

  it("starts an absolute beginner at the bottom", () => {
    expect(suggestedStageId(STAGES, "Pre-A1")).toBe("s1");
  });

  it("suggests nothing without a placement", () => {
    expect(suggestedStageId(STAGES, null)).toBeNull();
    expect(suggestedStageId(STAGES, undefined)).toBeNull();
  });

  it("suggests nothing for an unparsable level or band", () => {
    // No suggestion beats a wrong one.
    expect(suggestedStageId(STAGES, "advanced")).toBeNull();
    expect(suggestedStageId([stage("sX", 1, "later")], "B1")).toBeNull();
    expect(suggestedStageId([stage("sX", 1, null)], "B1")).toBeNull();
  });
});
