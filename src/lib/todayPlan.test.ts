import { describe, expect, it } from "vitest";
import { Play } from "lucide-react";
import type { TodayTask, TodayTaskId } from "@/hooks/useTodayQueue";
import { buildPlan, PLAN_SIZE } from "./todayPlan";

/**
 * Today's plan: three steps from the queue and one button.
 *
 * The screen it feeds has one job, answering "what do I do now?", so the
 * things worth pinning are which three tasks make the plan, that a hidden task
 * never takes a slot, and where the button goes once some of the day is done.
 */

const task = (id: TodayTaskId, over: Partial<TodayTask> = {}): TodayTask => ({
  id,
  title: id,
  estMinutes: 3,
  icon: Play,
  route: `/${id}`,
  done: false,
  xpEstimate: 10,
  ...over,
});

/** The queue as useTodayQueue returns it: its own order, not the plan's. */
const QUEUE: TodayTaskId[] = [
  "flashcards", "daily-challenge", "daily-story", "reading", "listening", "souq", "set-phrases",
];
const queue = (over: Partial<Record<TodayTaskId, Partial<TodayTask>>> = {}) =>
  QUEUE.map((id) => task(id, over[id]));

const ids = (tasks: TodayTask[]) => tasks.map((t) => t.id);

describe("choosing the plan", () => {
  it("leads with today's clip, then what is due, then the daily challenge", () => {
    const plan = buildPlan(queue());

    expect(ids(plan.steps)).toEqual(["listening", "flashcards", "daily-challenge"]);
    expect(plan.steps).toHaveLength(PLAN_SIZE);
  });

  it("keeps everything else as extras rather than dropping it", () => {
    const plan = buildPlan(queue());

    expect(ids(plan.extras)).toEqual(["daily-story", "reading", "set-phrases", "souq"]);
  });

  it("never gives a hidden task a slot", () => {
    // No clip published and no card due: the queue hides both, and a plan step
    // that leads to an empty page would be worse than no step.
    const plan = buildPlan(queue({ listening: { hidden: true }, flashcards: { hidden: true } }));

    expect(ids(plan.steps)).toEqual(["daily-challenge", "daily-story", "reading"]);
    expect(ids(plan.extras)).not.toContain("listening");
    expect(ids(plan.extras)).not.toContain("flashcards");
  });

  it("adds up the plan's minutes", () => {
    const plan = buildPlan(queue({ listening: { estMinutes: 2 }, flashcards: { estMinutes: 6 } }));

    expect(plan.minutes).toBe(2 + 6 + 3);
  });
});

describe("the button", () => {
  it("opens the first step on a fresh day", () => {
    expect(buildPlan(queue()).next?.id).toBe("listening");
  });

  it("skips what is already done", () => {
    const plan = buildPlan(queue({ listening: { done: true } }));

    expect(plan.next?.id).toBe("flashcards");
    expect(plan.done).toBe(1);
    expect(plan.complete).toBe(false);
  });

  it("moves on to the extras once the plan is finished", () => {
    const plan = buildPlan(
      queue({ listening: { done: true }, flashcards: { done: true }, "daily-challenge": { done: true } }),
    );

    expect(plan.complete).toBe(true);
    expect(plan.done).toBe(3);
    expect(plan.next?.id).toBe("daily-story");
  });

  it("has nowhere to go when the whole day is done", () => {
    const plan = buildPlan(queue(Object.fromEntries(QUEUE.map((id) => [id, { done: true }]))));

    expect(plan.complete).toBe(true);
    expect(plan.next).toBeUndefined();
  });
});
