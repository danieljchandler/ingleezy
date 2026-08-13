// Deriving a learner's position in the curriculum from their lesson progress.
//
// Kept pure and separate from the query layer so the branching — which lesson is
// "next up", what counts as started, how a re-run interacts with a best score —
// can be tested directly. See src/test/lessonPath.test.ts.

export type LessonStatus = "not_started" | "in_progress" | "completed";

/** A lesson_progress row, narrowed to what the path logic needs. */
export interface LessonProgressRow {
  lesson_id: string;
  status: "in_progress" | "completed";
  last_word_index: number;
  words_seen: number;
  words_total: number;
  best_score: number | null;
  completed_at: string | null;
}

/** A lesson, narrowed to what the path logic needs. */
export interface PathLesson {
  id: string;
  display_order: number;
}

export interface LessonPathState {
  status: LessonStatus;
  /** 0–100. Completed lessons read 100 even if the row lags behind. */
  percentComplete: number;
  /** Best quiz score across attempts, or null if never finished. */
  bestScore: number | null;
  /** Where to resume from. Always 0 for a completed or unstarted lesson. */
  resumeIndex: number;
  /**
   * The single lesson we point the learner at. Exactly one lesson in an ordered
   * list gets this, so the curriculum page always has one obvious next action
   * rather than a wall of equally-weighted rows.
   */
  isNextUp: boolean;
}

/** Index progress rows by lesson for O(1) lookup. */
export function indexProgress(rows: LessonProgressRow[]): Map<string, LessonProgressRow> {
  return new Map(rows.map((r) => [r.lesson_id, r]));
}

function percentFor(row: LessonProgressRow | undefined): number {
  if (!row) return 0;
  if (row.status === "completed") return 100;
  if (!row.words_total) return 0;
  const pct = (row.words_seen / row.words_total) * 100;
  // Never round a genuinely-started lesson down to 0 or up to 100 — both would
  // misreport it as unstarted or finished.
  return Math.min(99, Math.max(1, Math.round(pct)));
}

/**
 * Which lesson to point at: the first incomplete one in display order.
 *
 * Deliberately resolves to the first lesson for a learner with no progress at
 * all (a clean start still has an obvious entry point) and to null once
 * everything is done (nothing to nag about).
 */
export function findNextUpLessonId(
  lessons: PathLesson[],
  progress: Map<string, LessonProgressRow>,
): string | null {
  const ordered = [...lessons].sort((a, b) => a.display_order - b.display_order);
  // Prefer resuming something already started over opening something new.
  const started = ordered.find((l) => progress.get(l.id)?.status === "in_progress");
  if (started) return started.id;
  const untouched = ordered.find((l) => !progress.has(l.id));
  return untouched?.id ?? null;
}

/** Full display state for one lesson. */
export function lessonPathState(
  lesson: PathLesson,
  progress: Map<string, LessonProgressRow>,
  nextUpId: string | null,
): LessonPathState {
  const row = progress.get(lesson.id);
  const status: LessonStatus = !row
    ? "not_started"
    : row.status === "completed"
    ? "completed"
    : "in_progress";

  return {
    status,
    percentComplete: percentFor(row),
    bestScore: row?.best_score ?? null,
    resumeIndex: status === "in_progress" ? Math.max(0, row?.last_word_index ?? 0) : 0,
    isNextUp: lesson.id === nextUpId,
  };
}

/** Completed count and percentage for a stage header. */
export function stageCompletion(
  lessons: PathLesson[],
  progress: Map<string, LessonProgressRow>,
): { completed: number; total: number; percent: number } {
  const total = lessons.length;
  const completed = lessons.filter((l) => progress.get(l.id)?.status === "completed").length;
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

/**
 * The score to persist after an attempt — never lower than what's already
 * recorded, so re-running a lesson to practise can't erase a good result.
 */
export function mergeBestScore(previous: number | null | undefined, attempt: number): number {
  if (previous === null || previous === undefined) return attempt;
  return Math.max(previous, attempt);
}

// ── Lesson-plan rows ─────────────────────────────────────────────────────────
// The plan sections (lesson_sequence, real_world_prompts) come from spreadsheet
// sheets whose column headers vary between lessons, so they arrive as
// Record<string, string> with unpredictable keys. These helpers pull something
// presentable out of a row without assuming a fixed schema.

/** Columns that are structural rather than content. */
const INDEX_KEYS = /^(#|no\.?|num(ber)?|order|step)$/i;

/** Keys whose value reads as the row's headline, in priority order. */
const HEADLINE_KEYS = [
  /prompt/i,
  /task|activity/i,
  /instruction/i,
  /title|name|step/i,
  /description/i,
];

export interface PlanRowText {
  /** The row's leading number, when the sheet had one. */
  index: string | null;
  /** The main line to show. */
  headline: string;
  /** Everything else worth showing, in sheet order. */
  detail: string[];
}

/**
 * Reduce a spreadsheet row to a headline plus details.
 *
 * Returns null when a row has nothing renderable — blank rows are common at the
 * bottom of hand-maintained sheets, and rendering them produces empty cards.
 */
export function planRowText(row: Record<string, string>): PlanRowText | null {
  const entries = Object.entries(row)
    .map(([k, v]) => [k, typeof v === "string" ? v.trim() : ""] as const)
    .filter(([, v]) => v.length > 0);

  if (entries.length === 0) return null;

  const indexEntry = entries.find(([k]) => INDEX_KEYS.test(k.trim()));
  const content = entries.filter(([k]) => !INDEX_KEYS.test(k.trim()));
  if (content.length === 0) return null;

  let headlineEntry = content[0];
  for (const pattern of HEADLINE_KEYS) {
    const match = content.find(([k]) => pattern.test(k));
    if (match) {
      headlineEntry = match;
      break;
    }
  }

  return {
    index: indexEntry?.[1] ?? null,
    headline: headlineEntry[1],
    detail: content.filter((e) => e !== headlineEntry).map(([, v]) => v),
  };
}

/** Map rows to renderable text, dropping the blanks. */
export function planRows(rows: Record<string, string>[]): PlanRowText[] {
  return rows.map(planRowText).filter((r): r is PlanRowText => r !== null);
}
