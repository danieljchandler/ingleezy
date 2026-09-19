import { describe, expect, it } from "vitest";
import { effectiveStreak } from "@/lib/streak";

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
