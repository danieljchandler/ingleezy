import { describe, it, expect, beforeEach, vi } from "vitest";

// The module pulls in the Supabase client and gamification hooks at import
// time; the function under test is pure, so stub the IO surface out.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("@/hooks/useGamification", () => ({
  useAddXP: () => ({ mutate: vi.fn() }),
  useIncrementReviews: () => ({ mutate: vi.fn() }),
  useCheckAchievements: () => ({ mutate: vi.fn() }),
}));

import { buildReviewUpdate, type WordReview } from "@/hooks/useReview";

const NOW = new Date("2026-07-26T12:00:00.000Z");

const review = (over: Partial<WordReview> = {}): WordReview => ({
  id: "r1",
  user_id: "u1",
  word_id: "w1",
  ease_factor: 10,
  difficulty: 5,
  interval_days: 10,
  repetitions: 3,
  last_reviewed_at: "2026-07-16T12:00:00.000Z",
  next_review_at: "2026-07-26T12:00:00.000Z",
  lapses: 0,
  production_lapses: 0,
  production_ease_factor: 4,
  production_difficulty: 6,
  production_interval_days: 4,
  production_repetitions: 1,
  production_last_reviewed_at: "2026-07-22T12:00:00.000Z",
  production_next_review_at: "2026-07-26T12:00:00.000Z",
  ...over,
});

const RECOGNITION_COLUMNS = [
  "ease_factor",
  "difficulty",
  "interval_days",
  "repetitions",
  "next_review_at",
  "last_reviewed_at",
  "lapses",
];
const PRODUCTION_COLUMNS = [
  "production_ease_factor",
  "production_difficulty",
  "production_interval_days",
  "production_repetitions",
  "production_next_review_at",
  "production_last_reviewed_at",
  "production_lapses",
];

beforeEach(() => {
  localStorage.clear();
});

describe("buildReviewUpdate — column routing", () => {
  it("writes only recognition columns for a recognition rating", () => {
    const { update } = buildReviewUpdate("good", "recognition", review(), NOW);
    for (const col of RECOGNITION_COLUMNS) expect(update).toHaveProperty(col);
    for (const col of PRODUCTION_COLUMNS) {
      // production_next_review_at is the one legitimate cross-write: it unlocks
      // the direction. It's asserted separately below.
      if (col === "production_next_review_at") continue;
      expect(update).not.toHaveProperty(col);
    }
  });

  it("writes only production columns for a production rating", () => {
    const { update } = buildReviewUpdate("good", "production", review(), NOW);
    for (const col of PRODUCTION_COLUMNS) expect(update).toHaveProperty(col);
    for (const col of RECOGNITION_COLUMNS) expect(update).not.toHaveProperty(col);
  });

  it("reads the production schedule when rating production", () => {
    // Recognition stability is 10 and production is 4; a production rating must
    // grow from 4, not from 10, or the card is scheduled far too far out.
    const current = review();
    const { result } = buildReviewUpdate("good", "production", current, NOW);
    const recognition = buildReviewUpdate("good", "recognition", current, NOW);
    expect(result.stability).not.toBeCloseTo(recognition.result.stability);
    expect(result.stability).toBeGreaterThan(current.production_ease_factor!);
  });
});

describe("buildReviewUpdate — production unlock", () => {
  it("unlocks production on a confident recognition rating", () => {
    const { update } = buildReviewUpdate(
      "good",
      "recognition",
      review({ production_next_review_at: null }),
      NOW,
    );
    expect(update.production_next_review_at).toBe(NOW.toISOString());
  });

  it("unlocks on easy too", () => {
    const { update } = buildReviewUpdate(
      "easy",
      "recognition",
      review({ production_next_review_at: null }),
      NOW,
    );
    expect(update.production_next_review_at).toBe(NOW.toISOString());
  });

  it("does not unlock on again or hard", () => {
    // Production is a harder skill; asking for it before recognition is stable
    // just manufactures failures.
    for (const rating of ["again", "hard"] as const) {
      const { update } = buildReviewUpdate(
        rating,
        "recognition",
        review({ production_next_review_at: null }),
        NOW,
      );
      expect(update).not.toHaveProperty("production_next_review_at");
    }
  });

  it("does not reset an already-unlocked production schedule", () => {
    const { update } = buildReviewUpdate(
      "good",
      "recognition",
      review({ production_next_review_at: "2026-08-01T00:00:00.000Z" }),
      NOW,
    );
    expect(update).not.toHaveProperty("production_next_review_at");
  });

  it("unlocks production for a brand-new word rated good", () => {
    // No review row yet: the insert path must still open the production track.
    const { update } = buildReviewUpdate("good", "recognition", null, NOW);
    expect(update.production_next_review_at).toBe(NOW.toISOString());
    expect(update.repetitions).toBe(1);
  });
});

describe("buildReviewUpdate — lapses and leeches", () => {
  it("increments only the recognition lapse counter on a failed recognition", () => {
    const { update } = buildReviewUpdate(
      "again",
      "recognition",
      review({ lapses: 2, production_lapses: 1 }),
      NOW,
    );
    expect(update.lapses).toBe(3);
    expect(update).not.toHaveProperty("production_lapses");
  });

  it("increments only the production lapse counter on a failed production", () => {
    const { update } = buildReviewUpdate(
      "again",
      "production",
      review({ lapses: 2, production_lapses: 1 }),
      NOW,
    );
    expect(update.production_lapses).toBe(2);
    expect(update).not.toHaveProperty("lapses");
  });

  it("does not increment lapses on a successful rating", () => {
    const { update } = buildReviewUpdate("good", "recognition", review({ lapses: 2 }), NOW);
    expect(update.lapses).toBe(2);
  });

  it("flags a leech once either counter crosses the threshold", () => {
    const { update } = buildReviewUpdate(
      "again",
      "recognition",
      review({ lapses: 5, production_lapses: 0 }),
      NOW,
    );
    expect(update.is_leech).toBe(true);
  });

  it("respects the leech-tracking opt-out", () => {
    localStorage.setItem("ingleezy:leech-tracking-enabled", "false");
    const { update } = buildReviewUpdate(
      "again",
      "recognition",
      review({ lapses: 99 }),
      NOW,
    );
    expect(update.is_leech).toBe(false);
  });
});

describe("buildReviewUpdate — intervals", () => {
  it("never writes a negative interval", () => {
    const { update } = buildReviewUpdate("again", "recognition", review(), NOW);
    expect(update.interval_days as number).toBeGreaterThanOrEqual(0);
  });

  it("keeps a failed card due sooner than a passed one", () => {
    const failed = buildReviewUpdate("again", "recognition", review(), NOW);
    const passed = buildReviewUpdate("good", "recognition", review(), NOW);
    expect(new Date(failed.update.next_review_at as string).getTime()).toBeLessThan(
      new Date(passed.update.next_review_at as string).getTime(),
    );
  });
});
