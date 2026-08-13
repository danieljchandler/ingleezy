import { describe, expect, it } from "vitest";
import {
  buildSRSForecast,
  computeSRSRetentionRate,
  createEmptyStageBreakdown,
  getSRSStageByStability,
} from "@/lib/srsStats";

describe("srsStats helpers", () => {
  it("classifies a never-reviewed card as new regardless of stability", () => {
    expect(getSRSStageByStability(0, 0)).toBe("new");
    expect(getSRSStageByStability(0, 999)).toBe("new");
  });

  it("classifies stage boundaries by stability once a card has been reviewed", () => {
    expect(getSRSStageByStability(1, 0.5)).toBe("learning");
    expect(getSRSStageByStability(1, 3)).toBe("familiar");
    expect(getSRSStageByStability(1, 6.9)).toBe("familiar");
    expect(getSRSStageByStability(1, 7)).toBe("practiced");
    expect(getSRSStageByStability(1, 20)).toBe("practiced");
    expect(getSRSStageByStability(1, 21)).toBe("strong");
    expect(getSRSStageByStability(1, 59)).toBe("strong");
    expect(getSRSStageByStability(1, 60)).toBe("mastered");
  });

  it("does not call a chronically-lapsed card mastered just because repetitions kept climbing", () => {
    // calculateNextReview's forget branch preserves repetitions on "again"
    // (doesn't reset to 0), so a card with many repetitions can still have
    // low stability if it keeps getting forgotten. Stage should reflect that.
    expect(getSRSStageByStability(15, 0.5)).toBe("learning");
  });

  it("builds a 7-day forecast and buckets overdue cards into today", () => {
    const now = new Date("2026-05-24T12:00:00Z");
    const forecast = buildSRSForecast(
      [
        "2026-05-20T10:00:00Z",
        "2026-05-24T01:00:00Z",
        "2026-05-25T10:00:00Z",
        "2026-05-30T23:00:00Z",
        "2026-06-01T10:00:00Z",
      ],
      now,
    );

    expect(forecast).toHaveLength(7);
    expect(forecast[0].label).toBe("Today");
    expect(forecast[1].label).toBe("Tomorrow");
    expect(forecast[0].count).toBe(2);
    expect(forecast[1].count).toBe(1);
    expect(forecast[6].count).toBe(1);
  });

  it("computes retention as non-again review percentage", () => {
    const retention = computeSRSRetentionRate([
      { repetitions: 10, lapses: 2 },
      { repetitions: 5, lapses: 1 },
      { repetitions: 0, lapses: 0 },
    ]);
    expect(retention).toBe(80);
  });

  it("creates a zeroed stage breakdown", () => {
    expect(createEmptyStageBreakdown()).toEqual({
      new: 0,
      learning: 0,
      familiar: 0,
      practiced: 0,
      strong: 0,
      mastered: 0,
    });
  });
});
