import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aUserVocabulary,
  aWordReview,
  daysAgo,
  daysFromNow,
  reviewId,
  TEST_USER_ID,
  vocabId,
} from "@/test/support/factories";
import { useSRSStats } from "./useSRSStats";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The learner's whole review load, gathered from two decks.
 *
 * This is what the stats screen and the home ring are drawn from, and the
 * number that matters most is "due now" — it is the one a learner uses to
 * decide whether they have time to study. Getting it wrong in either direction
 * is costly: too low and they leave reviews unseen until the backlog is
 * unrecoverable, too high and the session looks longer than it is and they skip
 * it entirely.
 *
 * Two decks feed it, and one of them counts twice. A saved word is two cards —
 * recognition (seeing Arabic, recalling the meaning) and production (the
 * reverse) — scheduled independently, and production only exists once the
 * learner has started that direction. Missing that half is the easiest way for
 * this to under-report.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(
  curriculum: Record<string, unknown>[] = [],
  personal: Record<string, unknown>[] = [],
) {
  const seed = (backend: SupabaseBackend) => {
    backend.db.seed("word_reviews", curriculum);
    backend.db.seed("user_vocabulary", personal);
  };
  const harness = renderHookWithProviders(() => useSRSStats(), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

/** A curriculum card, due yesterday unless told otherwise. */
const aCurriculumCard = (index: number, over: Record<string, unknown> = {}) =>
  aWordReview({ id: reviewId(index), user_id: TEST_USER_ID, next_review_at: daysAgo(1), ...over });

/** A saved word with only the recognition direction started. */
const aSavedWord = (index: number, over: Record<string, unknown> = {}) =>
  aUserVocabulary({
    id: vocabId(index),
    user_id: TEST_USER_ID,
    next_review_at: daysAgo(1),
    production_next_review_at: null,
    ...over,
  });

describe("what is due", () => {
  it("counts the two decks separately and together", async () => {
    const { result } = render(
      [aCurriculumCard(0), aCurriculumCard(1)],
      [aSavedWord(0)],
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Separately because they are separate sessions the learner chooses
    // between, and together because that is the number on the home ring.
    expect(result.current.data).toMatchObject({
      curriculumDue: 2,
      myWordsDue: 1,
      totalDueNow: 3,
    });
  });

  it("leaves out cards scheduled for later", async () => {
    const { result } = render(
      [aCurriculumCard(0, { next_review_at: daysFromNow(3) })],
      [aSavedWord(0, { next_review_at: daysFromNow(3) })],
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The whole value of spaced repetition is not seeing a card before its
    // time; counting it as due would undo that at the level of the UI.
    expect(result.current.data?.totalDueNow).toBe(0);
  });

  it("counts a card due this instant", async () => {
    const { result } = render([aCurriculumCard(0, { next_review_at: new Date().toISOString() })]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The comparison is `<=`, so a card whose moment has exactly arrived is due
    // rather than waiting for the next millisecond.
    expect(result.current.data?.curriculumDue).toBe(1);
  });

  it("counts the production direction as its own due card", async () => {
    const { result } = render(
      [],
      [
        aSavedWord(0, {
          next_review_at: daysFromNow(5),
          production_next_review_at: daysAgo(1),
        }),
      ],
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Recognition and production are different skills on different schedules.
    // A word whose recall is solid can still be one the learner cannot produce,
    // and that is exactly the card worth showing.
    expect(result.current.data?.myWordsDue).toBe(1);
    expect(result.current.data?.myWordsCards).toBe(2);
  });

  it("counts both directions of the same word when both are due", async () => {
    const { result } = render(
      [],
      [aSavedWord(0, { production_next_review_at: daysAgo(1) })],
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.myWordsDue).toBe(2);
  });

  it("ignores a production direction the learner has not started", async () => {
    const { result } = render([], [aSavedWord(0)]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A null production date means that direction was never unlocked; counting
    // it would show a backlog of cards the learner has no way to reach.
    expect(result.current.data?.myWordsCards).toBe(1);
    expect(result.current.data?.myWordsDue).toBe(1);
  });

  it("leaves out another learner's cards", async () => {
    const { result } = render(
      [aCurriculumCard(0), aCurriculumCard(1, { user_id: "someone-else" })],
      [aSavedWord(0, { user_id: "someone-else" })],
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ curriculumCards: 1, myWordsCards: 0 });
  });
});

describe("the totals", () => {
  it("counts every card, due or not", async () => {
    const { result } = render(
      [aCurriculumCard(0), aCurriculumCard(1, { next_review_at: daysFromNow(30) })],
      [aSavedWord(0, { production_next_review_at: daysFromNow(30) })],
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // "How big is my deck" is a different question from "how much do I owe
    // today", and the stats screen asks both.
    expect(result.current.data).toMatchObject({
      curriculumCards: 2,
      myWordsCards: 2,
      totalCards: 4,
    });
  });

  it("returns zeroes for a learner who has reviewed nothing", async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A brand-new account renders this screen before it has a single card;
    // zeroes are a state, not a missing value.
    expect(result.current.data).toMatchObject({
      totalCards: 0,
      totalDueNow: 0,
      retentionRate: 0,
    });
    expect(result.current.data?.forecast.length).toBeGreaterThan(0);
  });
});

describe("the breakdown and the forecast", () => {
  it("sorts every card into a maturity stage", async () => {
    const { result } = render(
      [aCurriculumCard(0, { repetitions: 0, ease_factor: 0 })],
      [aSavedWord(0, { repetitions: 20, ease_factor: 200 })],
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const stages = result.current.data!.stageBreakdown;
    // Every card lands somewhere: the breakdown is rendered as a distribution,
    // and a card missing from it would make the bars disagree with the total.
    expect(Object.values(stages).reduce((sum, count) => sum + count, 0)).toBe(2);
  });

  it("builds a forecast from every scheduled date", async () => {
    const { result } = render(
      [aCurriculumCard(0, { next_review_at: daysFromNow(2) })],
      [
        aSavedWord(0, {
          next_review_at: daysFromNow(2),
          production_next_review_at: daysFromNow(2),
        }),
      ],
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const total = result.current.data!.forecast.reduce((sum, point) => sum + point.count, 0);
    // Both decks and both directions, so the "next 7 days" chart matches the
    // work that will actually arrive.
    expect(total).toBe(3);
  });

  it("computes retention from lapses across both decks", async () => {
    const { result } = render(
      [aCurriculumCard(0, { repetitions: 10, lapses: 0 })],
      [aSavedWord(0, { repetitions: 10, lapses: 0 })],
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A learner who has never lapsed is at full retention; the number is only
    // meaningful if it draws on everything they review.
    expect(result.current.data?.retentionRate).toBe(100);
  });

  it("treats missing counters as zero rather than as nothing", async () => {
    const { result } = render([
      aCurriculumCard(0, { repetitions: null, lapses: null, ease_factor: null }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Columns added by later migrations are null on old rows, and arithmetic on
    // null would turn one legacy card into NaN across the whole screen.
    expect(result.current.data?.curriculumCards).toBe(1);
    expect(Number.isNaN(result.current.data?.retentionRate)).toBe(false);
  });
});

describe("when there is nothing to read", () => {
  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useSRSStats(), { persona: "anonymous" });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });

  it("surfaces a failed curriculum read rather than half the picture", async () => {
    const harness = renderHookWithProviders(() => useSRSStats(), {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("user_vocabulary", [aSavedWord(0)]);
        backend.db.failAlways("word_reviews", 500, { message: "boom" });
      },
    });
    cleanup = harness.cleanup;

    // Reporting only the saved-words half would understate the backlog, which
    // is the direction that costs a learner their streak.
    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });

  it("surfaces a failed saved-words read too", async () => {
    const harness = renderHookWithProviders(() => useSRSStats(), {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("word_reviews", [aCurriculumCard(0)]);
        backend.db.failAlways("user_vocabulary", 500, { message: "boom" });
      },
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });
});
