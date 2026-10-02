import { describe, expect, it } from "vitest";
import { effectiveStreak, lastSevenDays } from "@/lib/streak";

/**
 * The number on every screen, derived rather than trusted.
 *
 * `review_streaks` only gets written when a review completes, because that is
 * the only event there is — a streak *ends* by nothing happening, and nothing
 * happening produces no row update. So the stored `current_streak` is right
 * until the first missed day and wrong from then until the next review.
 *
 * Found in review on the PR that gave the streak a writer at all, which is
 * exactly when it started to matter: while every streak was permanently zero
 * the staleness was invisible.
 */

const TODAY = "2026-09-19"; // a Saturday, chosen only for being unremarkable

describe("what a streak is worth right now", () => {
  it("counts a run the learner has already continued today", () => {
    expect(effectiveStreak({ current_streak: 11, last_review_date: TODAY }, TODAY)).toBe(11);
  });

  it("counts a run from yesterday, because today is not over", () => {
    // The learner reviewed at 11pm last night and opens the app at 9am. Nothing
    // has been missed, and showing zero here would be its own kind of lie.
    expect(effectiveStreak({ current_streak: 11, last_review_date: "2026-09-18" }, TODAY)).toBe(11);
  });

  it("is zero once a whole day has gone by untouched", () => {
    // The day before yesterday: Thursday was missed entirely, so the run ended.
    expect(effectiveStreak({ current_streak: 11, last_review_date: "2026-09-17" }, TODAY)).toBe(0);
  });

  it("is zero for a long-abandoned run", () => {
    expect(effectiveStreak({ current_streak: 47, last_review_date: "2026-01-02" }, TODAY)).toBe(0);
  });

  it("accepts a date ahead of the local one", () => {
    // `record_review_day` clamps to a day either side of the server's date, so
    // a learner far enough east can hold a row dated tomorrow by their device.
    // That is a real learner mid-streak, not a corrupt row.
    expect(effectiveStreak({ current_streak: 3, last_review_date: "2026-09-20" }, TODAY)).toBe(3);
  });

  it("crosses a month boundary", () => {
    expect(effectiveStreak({ current_streak: 5, last_review_date: "2026-08-31" }, "2026-09-01")).toBe(5);
    expect(effectiveStreak({ current_streak: 5, last_review_date: "2026-08-30" }, "2026-09-01")).toBe(0);
  });

  it("crosses a year boundary", () => {
    expect(effectiveStreak({ current_streak: 9, last_review_date: "2025-12-31" }, "2026-01-01")).toBe(9);
    expect(effectiveStreak({ current_streak: 9, last_review_date: "2025-12-30" }, "2026-01-01")).toBe(0);
  });

  it("is zero for a learner who has never reviewed", () => {
    // No row at all, and a row that exists with no date — a learner whose row
    // was created by something other than a review.
    expect(effectiveStreak(null, TODAY)).toBe(0);
    expect(effectiveStreak(undefined, TODAY)).toBe(0);
    expect(effectiveStreak({ current_streak: 0, last_review_date: null }, TODAY)).toBe(0);
  });

  it("does not report a negative or absent count", () => {
    expect(effectiveStreak({ current_streak: 0, last_review_date: TODAY }, TODAY)).toBe(0);
    expect(effectiveStreak({ last_review_date: TODAY }, TODAY)).toBe(0);
  });
});

/**
 * The seven cells under the streak count on Today.
 *
 * Drawn from the same single row, which records only the latest run — so the
 * one thing these can get wrong is claiming a day that run does not cover.
 */
describe("the last seven days", () => {
  const done = (row: Parameters<typeof lastSevenDays>[0], today = TODAY) =>
    lastSevenDays(row, today).filter((day) => day.done).map((day) => day.date);

  it("is seven days ending today, oldest first", () => {
    const days = lastSevenDays(null, TODAY);
    expect(days.map((day) => day.date)).toEqual([
      "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19",
    ]);
    expect(days.map((day) => day.isToday)).toEqual([false, false, false, false, false, false, true]);
  });

  it("labels each day with its Arabic weekday initial", () => {
    // 2026-09-13 is a Sunday, 2026-09-19 the Saturday under test.
    expect(lastSevenDays(null, TODAY).map((day) => day.label)).toEqual(["ح", "ن", "ث", "ر", "خ", "ج", "س"]);
  });

  it("marks a run that reaches today", () => {
    expect(done({ current_streak: 3, last_review_date: TODAY })).toEqual([
      "2026-09-17", "2026-09-18", "2026-09-19",
    ]);
  });

  it("leaves today open when the run ended yesterday", () => {
    // Not reviewed yet today is not a break, and not a done day either.
    expect(done({ current_streak: 2, last_review_date: "2026-09-18" })).toEqual([
      "2026-09-17", "2026-09-18",
    ]);
  });

  it("fills every cell for a run longer than a week", () => {
    expect(done({ current_streak: 40, last_review_date: TODAY })).toHaveLength(7);
  });

  it("marks nothing once the run has ended", () => {
    // The row still says 11, but a whole day went by: the run is over, so no
    // cell may claim to belong to it.
    expect(done({ current_streak: 11, last_review_date: "2026-09-17" })).toEqual([]);
  });

  it("marks nothing for a learner who has never reviewed", () => {
    expect(done(null)).toEqual([]);
  });

  it("crosses a month boundary", () => {
    expect(done({ current_streak: 3, last_review_date: "2026-09-01" }, "2026-09-01")).toEqual([
      "2026-08-30", "2026-08-31", "2026-09-01",
    ]);
  });
});
