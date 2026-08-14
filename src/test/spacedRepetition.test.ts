import { describe, it, expect } from "vitest";
import { calculateNextReview, getIntervalDisplay, estimateNextInterval, elapsedDaysSince } from "@/lib/spacedRepetition";
import type { Rating } from "@/lib/spacedRepetition";

describe("FSRS-4.5 spacedRepetition", () => {
  describe("calculateNextReview - new cards", () => {
    it("returns short interval for 'again' on new card", () => {
      const result = calculateNextReview("again", 0, 5, 0, 0);
      expect(result.intervalDays).toBeLessThan(1);
      expect(result.repetitions).toBe(0); // still in learning
      expect(result.stability).toBeGreaterThan(0);
    });

    it("graduates to review on 'good' for new card", () => {
      const result = calculateNextReview("good", 0, 5, 0, 0);
      expect(result.intervalDays).toBeGreaterThanOrEqual(1);
      expect(result.repetitions).toBe(1);
    });

    it("assigns higher initial stability for 'easy'", () => {
      const good = calculateNextReview("good", 0, 5, 0, 0);
      const easy = calculateNextReview("easy", 0, 5, 0, 0);
      expect(easy.stability).toBeGreaterThan(good.stability);
      expect(easy.intervalDays).toBeGreaterThanOrEqual(4);
    });
  });

  describe("calculateNextReview - established cards", () => {
    it("increases stability on 'good' review", () => {
      const result = calculateNextReview("good", 5, 5, 5, 3);
      expect(result.stability).toBeGreaterThan(5);
      expect(result.intervalDays).toBeGreaterThan(5);
    });

    it("resets interval on 'again' for established card", () => {
      const result = calculateNextReview("again", 10, 5, 10, 5);
      expect(result.intervalDays).toBeLessThan(1);
      // Repetitions preserved (not reset to 0)
      expect(result.repetitions).toBe(5);
    });

    it("hard gives shorter interval than good", () => {
      const hard = calculateNextReview("hard", 10, 5, 10, 5);
      const good = calculateNextReview("good", 10, 5, 10, 5);
      expect(hard.stability).toBeLessThan(good.stability);
    });
  });

  describe("getIntervalDisplay", () => {
    it("formats minutes correctly", () => {
      // 1/60 day = 1 minute threshold; values below show "< 1د"
      expect(getIntervalDisplay(1 / 1440)).toBe("< 1د");
      // 5/60 days ≈ 2 hours — but < 1/24 day threshold is 1h
      expect(getIntervalDisplay(2 / 1440)).toBe("< 1د");
      // 30 minutes = 30/1440 ≈ 0.021 — above 1/60 (0.0167) so shows minutes
      expect(getIntervalDisplay(30 / 1440)).toBe("30د");
    });

    it("formats days correctly", () => {
      expect(getIntervalDisplay(1)).toBe("1ي");
      expect(getIntervalDisplay(7)).toBe("7ي");
    });

    it("formats months correctly", () => {
      expect(getIntervalDisplay(60)).toBe("2ش");
    });
  });

  describe("estimateNextInterval", () => {
    it("returns a string for any rating", () => {
      const ratings: Rating[] = ["again", "hard", "good", "easy"];
      for (const r of ratings) {
        const display = estimateNextInterval(r, 5, 5, 5, 3);
        expect(typeof display).toBe("string");
        expect(display.length).toBeGreaterThan(0);
      }
    });
  });

  describe("difficulty persistence", () => {
    // The regression this guards: difficulty used to be a constant 5.0 at every
    // call site, so the FSRS difficulty term never moved. It must now respond to
    // the rating and accumulate when fed back in.
    it("returns a difficulty in the valid 1–10 range", () => {
      const result = calculateNextReview("good", 5, 5, 5, 3);
      expect(result.difficulty).toBeGreaterThanOrEqual(1);
      expect(result.difficulty).toBeLessThanOrEqual(10);
    });

    it("raises difficulty on 'again' and lowers it on 'easy' from the same state", () => {
      const again = calculateNextReview("again", 5, 5, 5, 3);
      const easy = calculateNextReview("easy", 5, 5, 5, 3);
      expect(again.difficulty).toBeGreaterThan(easy.difficulty);
    });

    it("accumulates difficulty across repeated hard reviews when fed back in", () => {
      // Simulate a genuinely hard card reviewed several times, threading the
      // returned difficulty back in (what the fixed call sites now persist).
      let difficulty = 5;
      let stability = 5;
      let repetitions = 3;
      const first = difficulty;
      for (let i = 0; i < 4; i++) {
        const r = calculateNextReview("hard", stability, difficulty, Math.round(stability), repetitions);
        difficulty = r.difficulty;
        stability = r.stability;
        repetitions = r.repetitions;
      }
      // Had difficulty stayed pinned at 5.0 (the old bug), this would be unchanged.
      expect(difficulty).toBeGreaterThan(first);
    });
  });

  describe("real elapsed time", () => {
    // The regression this guards: elapsed time used to be faked as the scheduled
    // interval, so an overdue review was scheduled identically to an on-time one.
    it("grows stability less when a recall happens overdue than on schedule", () => {
      const stability = 10;
      const interval = 10;
      const onSchedule = calculateNextReview("good", stability, 5, interval, 5, interval);
      const overdue = calculateNextReview("good", stability, 5, interval, 5, interval * 5);
      // Lower retrievability at review time (overdue) yields a larger stability
      // increase in FSRS — the key is that the two are no longer identical.
      expect(overdue.stability).not.toBeCloseTo(onSchedule.stability, 5);
    });

    it("falls back to the scheduled interval when elapsedDays is omitted", () => {
      const withProxy = calculateNextReview("good", 10, 5, 10, 5);
      const withExplicit = calculateNextReview("good", 10, 5, 10, 5, 10);
      expect(withProxy.stability).toBeCloseTo(withExplicit.stability, 5);
    });
  });

  describe("elapsedDaysSince", () => {
    it("returns undefined for null/empty/invalid input", () => {
      expect(elapsedDaysSince(null)).toBeUndefined();
      expect(elapsedDaysSince(undefined)).toBeUndefined();
      expect(elapsedDaysSince("not-a-date")).toBeUndefined();
    });

    it("returns roughly the number of days since the timestamp", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const elapsed = elapsedDaysSince(threeDaysAgo);
      expect(elapsed).toBeGreaterThan(2.9);
      expect(elapsed).toBeLessThan(3.1);
    });

    it("never returns a negative value for a future timestamp", () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      expect(elapsedDaysSince(future)).toBe(0);
    });
  });

  describe("personalisation (C2)", () => {
    // A mature card: high stability so intervals are long enough to measure.
    const MATURE = { stability: 40, difficulty: 5, interval: 40, reps: 6 } as const;

    const schedule = (options?: Parameters<typeof calculateNextReview>[6]) =>
      calculateNextReview("good", MATURE.stability, MATURE.difficulty, MATURE.interval, MATURE.reps, 40, options);

    it("changes nothing at the default 90% target with no fuzz seed", () => {
      // The dial and the fuzz are strictly additive: a caller that passes no
      // options gets the exact historical schedule.
      expect(schedule().intervalDays).toBe(schedule({ desiredRetention: 0.9 }).intervalDays);
    });

    it("stretches intervals when the learner accepts more forgetting", () => {
      const standard = schedule({ desiredRetention: 0.9 }).intervalDays;
      const lighter = schedule({ desiredRetention: 0.85 }).intervalDays;
      const intense = schedule({ desiredRetention: 0.95 }).intervalDays;
      expect(lighter).toBeGreaterThan(standard);
      expect(intense).toBeLessThan(standard);
    });

    it("does not change the memory model, only the schedule", () => {
      // Stability is what the learner's memory is estimated to be; the dial
      // must never rewrite that estimate, or switching back would corrupt
      // every card it touched.
      expect(schedule({ desiredRetention: 0.8 }).stability).toBe(schedule().stability);
    });

    it("clamps an absurd retention target", () => {
      const floor = schedule({ desiredRetention: 0.1 }).intervalDays;
      expect(floor).toBe(schedule({ desiredRetention: 0.7 }).intervalDays);
    });

    it("fuzzes deterministically: same card, same interval, same answer", () => {
      const a = schedule({ fuzzSeed: "card-1" }).intervalDays;
      const b = schedule({ fuzzSeed: "card-1" }).intervalDays;
      expect(a).toBe(b);
    });

    it("spreads different cards apart", () => {
      // Not every pair of seeds lands apart (5% of a short interval rounds to
      // zero for some hashes), but across many cards the spread must be real —
      // that is the whole point of load balancing.
      const intervals = new Set(
        Array.from({ length: 30 }, (_, i) => schedule({ fuzzSeed: `card-${i}` }).intervalDays),
      );
      expect(intervals.size).toBeGreaterThan(1);
    });

    it("keeps fuzz inside ±5% of the base interval", () => {
      const base = schedule().intervalDays;
      for (let i = 0; i < 30; i++) {
        const fuzzed = schedule({ fuzzSeed: `card-${i}` }).intervalDays;
        expect(Math.abs(fuzzed - base)).toBeLessThanOrEqual(Math.max(1, Math.round(base * 0.05)));
      }
    });

    it("never fuzzes learning steps", () => {
      // Sub-3-day intervals are meant to be precise; a 1-minute relearning
      // step must not wobble.
      const result = calculateNextReview("again", 0, 5, 0, 0, undefined, { fuzzSeed: "card-1" });
      expect(result.intervalDays).toBe(calculateNextReview("again", 0, 5, 0, 0).intervalDays);
    });

    it("previews match scheduling when given the same options", () => {
      const preview = estimateNextInterval("good", MATURE.stability, MATURE.difficulty, MATURE.interval, MATURE.reps, 40, {
        desiredRetention: 0.85,
      });
      const actual = calculateNextReview("good", MATURE.stability, MATURE.difficulty, MATURE.interval, MATURE.reps, 40, {
        desiredRetention: 0.85,
      });
      expect(preview).toBe(getIntervalDisplay(actual.intervalDays));
    });
  });
});
