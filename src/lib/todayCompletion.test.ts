import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCompletedToday,
  getDailyGoal,
  isTaskCompletedToday,
  markTaskCompletedToday,
  setDailyGoal,
} from "./todayCompletion";

/**
 * Which of today's tasks the learner has finished.
 *
 * Stored per local calendar day so it resets at midnight without anything
 * having to clear it. That makes it exactly the kind of code that works all day
 * and breaks at 23:59, so time is frozen deliberately here rather than left to
 * whenever CI happens to run.
 */

// Mid-morning, mid-month, well away from a midnight or DST boundary.
const NOON = new Date("2026-03-11T12:00:00");

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("marking tasks", () => {
  it("remembers a task once marked", () => {
    expect(isTaskCompletedToday("flashcards")).toBe(false);

    markTaskCompletedToday("flashcards");

    expect(isTaskCompletedToday("flashcards")).toBe(true);
  });

  it("keeps tasks independent", () => {
    markTaskCompletedToday("flashcards");

    expect(isTaskCompletedToday("daily-story")).toBe(false);
  });

  it("marking twice does not duplicate", () => {
    markTaskCompletedToday("flashcards");
    markTaskCompletedToday("flashcards");

    expect(getCompletedToday()).toEqual(["flashcards"]);
  });

  it("lists everything finished today", () => {
    markTaskCompletedToday("flashcards");
    markTaskCompletedToday("souq");

    expect(getCompletedToday().sort()).toEqual(["flashcards", "souq"]);
  });

  it("announces the change, so the home queue can refresh", () => {
    // The Today list listens for this rather than polling; without it a task
    // completed on another screen stays unticked until a reload.
    const listener = vi.fn();
    window.addEventListener("today:tasks-changed", listener);

    markTaskCompletedToday("flashcards");

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("today:tasks-changed", listener);
  });
});

describe("the daily reset", () => {
  it("forgets yesterday's completions once the date rolls over", () => {
    markTaskCompletedToday("flashcards");
    expect(isTaskCompletedToday("flashcards")).toBe(true);

    vi.setSystemTime(new Date("2026-03-12T09:00:00"));

    expect(isTaskCompletedToday("flashcards")).toBe(false);
    expect(getCompletedToday()).toEqual([]);
  });

  it("holds across the working day", () => {
    markTaskCompletedToday("flashcards");

    vi.setSystemTime(new Date("2026-03-11T23:59:00"));

    expect(isTaskCompletedToday("flashcards")).toBe(true);
  });

  it("resets exactly at local midnight, not UTC midnight", () => {
    // The key is built from local getFullYear/getMonth/getDate, so a learner
    // west of UTC would otherwise see their day reset in the early evening.
    markTaskCompletedToday("flashcards");

    vi.setSystemTime(new Date("2026-03-11T23:59:59"));
    expect(isTaskCompletedToday("flashcards")).toBe(true);

    vi.setSystemTime(new Date("2026-03-12T00:00:01"));
    expect(isTaskCompletedToday("flashcards")).toBe(false);
  });

  it("brings back the same day's completions if the clock returns", () => {
    // Each day has its own key, so yesterday's record is not destroyed — it is
    // just not read.
    markTaskCompletedToday("flashcards");

    vi.setSystemTime(new Date("2026-03-12T09:00:00"));
    expect(isTaskCompletedToday("flashcards")).toBe(false);

    vi.setSystemTime(NOON);
    expect(isTaskCompletedToday("flashcards")).toBe(true);
  });

  it("pads single-digit months and days, so keys cannot collide", () => {
    // Without padding "2026-1-11" and "2026-11-1" both shorten ambiguously.
    vi.setSystemTime(new Date("2026-01-02T12:00:00"));
    markTaskCompletedToday("flashcards");

    expect(localStorage.getItem("today.completed.2026-01-02")).toContain("flashcards");
  });
});

describe("the daily goal", () => {
  it("defaults to 100 when nothing is set", () => {
    expect(getDailyGoal()).toBe(100);
  });

  it("round-trips a chosen goal", () => {
    setDailyGoal(250);
    expect(getDailyGoal()).toBe(250);
  });

  it("announces a change so the goal ring can update", () => {
    const listener = vi.fn();
    window.addEventListener("today:goal-changed", listener);

    setDailyGoal(250);

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("today:goal-changed", listener);
  });

  it("falls back to the default rather than trusting a corrupt value", () => {
    // A zero or negative goal would divide by zero in the progress ring.
    for (const bad of ["0", "-5", "not-a-number", ""]) {
      localStorage.setItem("today.goal", bad);
      expect(getDailyGoal()).toBe(100);
    }
  });

  it("does not reset with the day", () => {
    setDailyGoal(250);

    vi.setSystemTime(new Date("2026-03-12T09:00:00"));

    expect(getDailyGoal()).toBe(250);
  });
});

describe("unavailable storage", () => {
  it("reports nothing completed rather than throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(isTaskCompletedToday("flashcards")).toBe(false);
    expect(getCompletedToday()).toEqual([]);
    expect(getDailyGoal()).toBe(100);
  });

  it("still announces the change when the write is blocked", () => {
    // The learner has done the task either way; the UI should tick it even if
    // the record does not survive a reload.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const listener = vi.fn();
    window.addEventListener("today:tasks-changed", listener);

    expect(() => markTaskCompletedToday("flashcards")).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener("today:tasks-changed", listener);
  });

  it("treats unparseable storage as nothing completed", () => {
    localStorage.setItem("today.completed.2026-03-11", "{not json");
    expect(getCompletedToday()).toEqual([]);
  });
});
