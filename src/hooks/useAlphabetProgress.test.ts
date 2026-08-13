import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { ARABIC_LETTERS, LETTER_STEPS } from "@/data/arabicAlphabet";
import { useAuth } from "./useAuth";
import { useAlphabetProgress, useCheckpointProgress } from "./useAlphabetProgress";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The alphabet journey.
 *
 * A strictly sequential track: letters unlock one at a time and only when the
 * one before is mastered, and mastery means finishing all six steps. That makes
 * the unlock rule the whole feature — too loose and a beginner can skip to the
 * end, too tight and they are stuck on a letter they have already finished with
 * no way to say so.
 *
 * Progress is upserted per letter rather than appended, so every write has to
 * merge with what is already there. Losing a step, or resetting a best score to
 * a worse attempt, silently un-does work the learner has done.
 */

const FIRST = ARABIC_LETTERS[0].code;
const SECOND = ARABIC_LETTERS[1].code;
const THIRD = ARABIC_LETTERS[2].code;

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-03-11T12:00:00Z"));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

const aLetterRow = (code: string, over: Record<string, unknown> = {}) => ({
  user_id: TEST_USER_ID,
  letter_code: code,
  steps_completed: [],
  best_spot_score: 0,
  best_sound_score: 0,
  mastered_at: null,
  last_practiced_at: new Date().toISOString(),
  ...over,
});

/** A letter with every step finished. */
const aMasteredLetter = (code: string) =>
  aLetterRow(code, {
    steps_completed: [...LETTER_STEPS],
    mastered_at: new Date("2026-03-01T12:00:00Z").toISOString(),
    best_spot_score: 90,
    best_sound_score: 85,
  });

async function render(seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(
    () => ({ ...useAlphabetProgress(), user: useAuth().user }),
    {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("user_letter_progress", []);
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.isLoading).toBe(false));
  await waitFor(() => expect(harness.result.current.user).toBeTruthy());
  return harness;
}

describe("what a learner has unlocked", () => {
  it("unlocks only the first letter at the start", async () => {
    const { result } = await render();

    expect(result.current.isUnlocked(0)).toBe(true);
    // Sequential is the point: a beginner who can jump to letter 28 skips the
    // shapes the later ones are built from.
    expect(result.current.isUnlocked(1)).toBe(false);
  });

  it("unlocks the next letter once the current one is mastered", async () => {
    const { result } = await render((backend) => {
      backend.db.seed("user_letter_progress", [aMasteredLetter(FIRST)]);
    });

    await waitFor(() => expect(result.current.isUnlocked(1)).toBe(true));
    expect(result.current.isUnlocked(2)).toBe(false);
  });

  it("keeps a mastered letter unlocked", async () => {
    const { result } = await render((backend) => {
      backend.db.seed("user_letter_progress", [aMasteredLetter(FIRST)]);
    });

    // Revisiting a letter is how a learner practises; locking it behind them
    // would make the track one-way.
    await waitFor(() => expect(result.current.isUnlocked(0)).toBe(true));
  });

  it("does not unlock the next letter for a partly finished one", async () => {
    const { result } = await render((backend) => {
      backend.db.seed("user_letter_progress", [
        aLetterRow(FIRST, { steps_completed: ["meet", "examples"] }),
      ]);
    });

    // Started is not finished. Unlocking on first touch would let a learner
    // walk the whole alphabet by opening each letter once.
    await waitFor(() => expect(result.current.progress[FIRST]).toBeTruthy());
    expect(result.current.isUnlocked(1)).toBe(false);
  });

  it("skips past a gap rather than stalling on it", async () => {
    const { result } = await render((backend) => {
      // Mastered out of order — possible if the unlock rule ever changed.
      backend.db.seed("user_letter_progress", [
        aMasteredLetter(FIRST),
        aMasteredLetter(THIRD),
      ]);
    });

    // The frontier is the first *un*mastered letter, so the second one is where
    // the learner is sent — not the third, which they have already done.
    await waitFor(() => expect(result.current.isUnlocked(1)).toBe(true));
    expect(result.current.isUnlocked(2)).toBe(false);
  });

  it("counts how many letters are mastered", async () => {
    const { result } = await render((backend) => {
      backend.db.seed("user_letter_progress", [
        aMasteredLetter(FIRST),
        aMasteredLetter(SECOND),
        aLetterRow(THIRD, { steps_completed: ["meet"] }),
      ]);
    });

    // Counted on mastered_at, not on having a row: the third letter has been
    // started and must not inflate the count on the home card.
    await waitFor(() => expect(result.current.masteredCount).toBe(2));
  });

  it("reports nothing for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useAlphabetProgress(), {
      seed: (backend) =>
        backend.db.seed("user_letter_progress", [aMasteredLetter(FIRST)]),
    });
    cleanup = harness.cleanup;

    await waitFor(() =>
      expect(harness.backend.db.readsOf("user_letter_progress")).toHaveLength(0),
    );
    expect(harness.result.current.masteredCount).toBe(0);
    expect(harness.result.current.isUnlocked(0)).toBe(true);
  });
});

describe("finishing a step", () => {
  it("records it against the letter", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "meet" });
    });

    const row = backend.db.rows("user_letter_progress")[0];
    expect(row.letter_code).toBe(FIRST);
    expect(row.steps_completed).toEqual(["meet"]);
  });

  it("adds to the steps already done rather than replacing them", async () => {
    const { result, backend } = await render((b) => {
      b.db.seed("user_letter_progress", [
        aLetterRow(FIRST, { steps_completed: ["meet", "examples"] }),
      ]);
    });

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "trace" });
    });

    // The write is an upsert of the whole row, so a replace here would erase
    // two steps the learner had already finished.
    expect(backend.db.rows("user_letter_progress")[0].steps_completed).toEqual([
      "meet",
      "examples",
      "trace",
    ]);
  });

  it("keeps the steps in their taught order, not the order finished", async () => {
    const { result, backend } = await render((b) => {
      b.db.seed("user_letter_progress", [aLetterRow(FIRST, { steps_completed: ["sound"] })]);
    });
    await waitFor(() => expect(result.current.progress[FIRST]).toBeTruthy());

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "meet" });
    });

    // The progress dots read left to right; storing them in completion order
    // would draw them scrambled.
    expect(backend.db.rows("user_letter_progress")[0].steps_completed).toEqual([
      "meet",
      "sound",
    ]);
  });

  it("loses a step completed before the previous one has been read back", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "meet" });
      await result.current.completeStep({ letterCode: FIRST, step: "trace" });
    });

    // Recording current behaviour. `completeStep` merges against `query.data`
    // — the cached query result — rather than re-reading the row, and the
    // refetch is only triggered on success. Two completions closer together
    // than that round trip therefore write the second on top of the first
    // rather than alongside it.
    //
    // In practice the six steps are separate screens with navigation between
    // them, so the refetch normally lands first. A learner tapping quickly
    // through two, or a double-fire, silently loses one — and the only symptom
    // is a progress dot that will not stay filled.
    //
    // This test fails once the merge reads the row it is writing.
    expect(backend.db.rows("user_letter_progress")[0].steps_completed).toEqual(["trace"]);
  });

  it("does the same step twice without duplicating it", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "meet" });
      await result.current.completeStep({ letterCode: FIRST, step: "meet" });
    });

    expect(backend.db.rows("user_letter_progress")[0].steps_completed).toEqual(["meet"]);
  });

  it("keeps the better of two scores", async () => {
    const { result, backend } = await render((b) => {
      b.db.seed("user_letter_progress", [
        aLetterRow(FIRST, { steps_completed: ["spot"], best_spot_score: 90 }),
      ]);
    });

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "spot", spotScore: 40 });
    });

    // "Best" has to mean best; overwriting turns practice into a way of losing
    // a score already earned.
    expect(Number(backend.db.rows("user_letter_progress")[0].best_spot_score)).toBe(90);
  });

  it("takes a better score when there is one", async () => {
    const { result, backend } = await render((b) => {
      b.db.seed("user_letter_progress", [
        aLetterRow(FIRST, { steps_completed: ["spot"], best_spot_score: 40 }),
      ]);
    });

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "spot", spotScore: 95 });
    });

    expect(Number(backend.db.rows("user_letter_progress")[0].best_spot_score)).toBe(95);
  });

  it("keeps the two scores apart", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "sound", soundScore: 77 });
    });

    const row = backend.db.rows("user_letter_progress")[0];
    expect(Number(row.best_sound_score)).toBe(77);
    expect(Number(row.best_spot_score)).toBe(0);
  });

  it("marks the letter mastered only on the last step", async () => {
    const partial = LETTER_STEPS.slice(0, -1);
    const { result, backend } = await render((b) => {
      b.db.seed("user_letter_progress", [
        aLetterRow(FIRST, { steps_completed: [...partial] }),
      ]);
    });

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: LETTER_STEPS.at(-1)! });
    });

    // Mastery is what unlocks the next letter, so declaring it early opens the
    // whole track and declaring it late strands the learner.
    expect(backend.db.rows("user_letter_progress")[0].mastered_at).toBeTruthy();
  });

  it("does not mark it mastered before then", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "meet" });
    });

    expect(backend.db.rows("user_letter_progress")[0].mastered_at).toBeNull();
  });

  it("keeps the date a letter was first mastered", async () => {
    const originally = new Date("2026-03-01T12:00:00Z").toISOString();
    const { result, backend } = await render((b) => {
      b.db.seed("user_letter_progress", [aMasteredLetter(FIRST)]);
    });

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "spot", spotScore: 99 });
    });

    // Practising a mastered letter must not restamp it as newly learned; the
    // date is a record of when it happened.
    expect(backend.db.rows("user_letter_progress")[0].mastered_at).toBe(originally);
  });

  it("keeps one row per letter", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ letterCode: FIRST, step: "meet" });
      await result.current.completeStep({ letterCode: SECOND, step: "meet" });
      await result.current.completeStep({ letterCode: FIRST, step: "trace" });
    });

    // Upserted on (user_id, letter_code); two rows for one letter would give it
    // two different sets of completed steps.
    expect(backend.db.rows("user_letter_progress")).toHaveLength(2);
  });

  it("refuses to record anything when signed out", async () => {
    const harness = renderHookWithProviders(() => useAlphabetProgress(), {
      seed: (b) => b.db.seed("user_letter_progress", []),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await expect(
        harness.result.current.completeStep({ letterCode: FIRST, step: "meet" }),
      ).rejects.toThrow(/not signed in/i);
    });
    expect(harness.backend.db.rows("user_letter_progress")).toHaveLength(0);
  });
});

describe("checkpoints", () => {
  it("records a checkpoint attempt", async () => {
    const harness = renderHookWithProviders(
      () => ({ ...useCheckpointProgress(), user: useAuth().user }),
      {
        persona: "free",
        seed: (b) => b.db.seed("user_checkpoint_progress", []),
      },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.user).toBeTruthy());

    await act(async () => {
      await harness.result.current.recordCheckpoint({ index: 0, score: 80 });
    });

    const row = harness.backend.db.rows("user_checkpoint_progress")[0];
    expect(Number(row.checkpoint_index)).toBe(0);
    expect(Number(row.best_score)).toBe(80);
  });

  it("reads back the checkpoints already passed", async () => {
    const harness = renderHookWithProviders(() => useCheckpointProgress(), {
      persona: "free",
      seed: (b) =>
        b.db.seed("user_checkpoint_progress", [
          {
            user_id: TEST_USER_ID,
            checkpoint_index: 0,
            score: 80,
            completed_at: new Date().toISOString(),
          },
        ]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.checkpoints[0]).toBeTruthy());
    expect(harness.result.current.checkpoints[0].score).toBe(80);
  });

  it("refuses to record anything when signed out", async () => {
    const harness = renderHookWithProviders(() => useCheckpointProgress(), {
      seed: (b) => b.db.seed("user_checkpoint_progress", []),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await expect(
        harness.result.current.recordCheckpoint({ index: 0, score: 80 }),
      ).rejects.toThrow(/not signed in/i);
    });
  });
});
