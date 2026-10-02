import type { TodayTask, TodayTaskId } from "@/hooks/useTodayQueue";

/**
 * Turns the daily queue into a plan: three steps and one button.
 *
 * The queue offers up to seven tasks. Shown all at once, beside three progress
 * rings, they were the reason the old home page had about twenty-five things to
 * tap and no obvious first one. A plan answers the only question the screen has
 * to answer — what do I do now? — so it takes the three that matter most today
 * and keeps the rest one level down, as extras for a learner with time left.
 *
 * Order is the app's priority: watch real English first (the core loop), then
 * clear what the spaced-repetition decks say is due, then the daily one-offs.
 * Tasks the queue hides (no clip published, nothing due) are skipped, so the
 * plan is always three things that can actually be done.
 */

const PRIORITY: TodayTaskId[] = [
  "listening",
  "flashcards",
  "daily-challenge",
  "daily-story",
  "reading",
  "set-phrases",
  "souq",
];

export const PLAN_SIZE = 3;

export interface TodayPlan {
  /** The day's plan, in the order it should be done. */
  steps: TodayTask[];
  /** Everything else available today. */
  extras: TodayTask[];
  /** What the main button opens: the first unfinished step, then the first unfinished extra. */
  next: TodayTask | undefined;
  /** Steps finished, out of `steps.length`. */
  done: number;
  /** Every step is finished. */
  complete: boolean;
  /** The plan's estimated length, in minutes. */
  minutes: number;
}

const rank = (task: TodayTask) => {
  const index = PRIORITY.indexOf(task.id);
  return index === -1 ? PRIORITY.length : index;
};

export function buildPlan(tasks: TodayTask[]): TodayPlan {
  const available = tasks.filter((task) => !task.hidden).sort((a, b) => rank(a) - rank(b));
  const steps = available.slice(0, PLAN_SIZE);
  const extras = available.slice(PLAN_SIZE);
  const done = steps.filter((task) => task.done).length;

  return {
    steps,
    extras,
    next: steps.find((task) => !task.done) ?? extras.find((task) => !task.done),
    done,
    complete: steps.length > 0 && done === steps.length,
    minutes: steps.reduce((sum, task) => sum + task.estMinutes, 0),
  };
}
