import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { ENGLISH_SOUNDS, SOUND_STEPS } from "@/data/englishSounds";
import { useAuth } from "./useAuth";
import { useSoundProgress, useCheckpointProgress } from "./useSoundProgress";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The English Sounds journey.
 *
 * A strictly sequential track: sounds unlock one at a time and only when the
 * one before is mastered, and mastery means finishing all six steps. That
 * makes the unlock rule the whole feature — too loose and a beginner can
 * skip to the end, too tight and they are stuck on a sound they have already
 * finished with no way to say so.
 *
 * Progress is upserted per sound rather than appended, so every write has to
 * merge with what is already there. Losing a step, or resetting a best score
 * to a worse attempt, silently un-does work the learner has done.
 *
 * This is the flipped descendant of Hakiya's useAlphabetProgress — same
 * shape and same rules, on a table since renamed from `user_letter_progress`
 * to match what it actually records.
 */

const FIRST = ENGLISH_SOUNDS[0].code;
const SECOND = ENGLISH_SOUNDS[1].code;
const THIRD = ENGLISH_SOUNDS[2].code;

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

const aSoundRow = (code: string, over: Record<string, unknown> = {}) => ({
  user_id: TEST_USER_ID,
  sound_code: code,
  steps_completed: [],
  best_spot_score: 0,
  best_sound_score: 0,
  mastered_at: null,
  last_practiced_at: new Date().toISOString(),
  ...over,
});

/** A sound with every step finished. */
const aMasteredSound = (code: string) =>
  aSoundRow(code, {
    steps_completed: [...SOUND_STEPS],
    mastered_at: new Date("2026-03-01T12:00:00Z").toISOString(),
    best_spot_score: 90,
    best_sound_score: 85,
  });

async function render(seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(
    () => ({ ...useSoundProgress(), user: useAuth().user }),
    {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("user_sound_progress", []);
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
  it("unlocks only the first sound at the start", async () => {
    const { result } = await render();

    expect(result.current.isUnlocked(0)).toBe(true);
    // Sequential is the point: a beginner who can jump to sound 28 skips the
    // contrasts the later ones are built from.
    expect(result.current.isUnlocked(1)).toBe(false);
  });

  it("unlocks the next sound once the current one is mastered", async () => {
    const { result } = await render((backend) => {
      backend.db.seed("user_sound_progress", [aMasteredSound(FIRST)]);
    });

    await waitFor(() => expect(result.current.isUnlocked(1)).toBe(true));
    expect(result.current.isUnlocked(2)).toBe(false);
  });

  it("keeps a mastered sound unlocked", async () => {
    const { result } = await render((backend) => {
      backend.db.seed("user_sound_progress", [aMasteredSound(FIRST)]);
    });

    // Revisiting a sound is how a learner practises; locking it behind them
    // would make the track one-way.
    await waitFor(() => expect(result.current.isUnlocked(0)).toBe(true));
  });

  it("does not unlock the next sound for a partly finished one", async () => {
    const { result } = await render((backend) => {
      backend.db.seed("user_sound_progress", [
        aSoundRow(FIRST, { steps_completed: ["meet", "mouth"] }),
      ]);
    });

    // Started is not finished. Unlocking on first touch would let a learner
    // walk the whole journey by opening each sound once.
    await waitFor(() => expect(result.current.progress[FIRST]).toBeTruthy());
    expect(result.current.isUnlocked(1)).toBe(false);
  });

  it("skips past a gap rather than stalling on it", async () => {
    const { result } = await render((backend) => {
      // Mastered out of order — possible if the unlock rule ever changed.
      backend.db.seed("user_sound_progress", [
        aMasteredSound(FIRST),
        aMasteredSound(THIRD),
      ]);
    });

    // The frontier is the first *un*mastered sound, so the second one is
    // where the learner is sent — not the third, which they have already
    // done.
    await waitFor(() => expect(result.current.isUnlocked(1)).toBe(true));
    expect(result.current.isUnlocked(2)).toBe(false);
  });

  it("counts how many sounds are mastered", async () => {
    const { result } = await render((backend) => {
      backend.db.seed("user_sound_progress", [
        aMasteredSound(FIRST),
        aMasteredSound(SECOND),
        aSoundRow(THIRD, { steps_completed: ["meet"] }),
      ]);
    });

    // Counted on mastered_at, not on having a row: the third sound has been
    // started and must not inflate the count on the home card.
    await waitFor(() => expect(result.current.masteredCount).toBe(2));
  });

  it("reports nothing for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useSoundProgress(), {
      seed: (backend) =>
        backend.db.seed("user_sound_progress", [aMasteredSound(FIRST)]),
    });
    cleanup = harness.cleanup;

    await waitFor(() =>
      expect(harness.backend.db.readsOf("user_sound_progress")).toHaveLength(0),
    );
    expect(harness.result.current.masteredCount).toBe(0);
    expect(harness.result.current.isUnlocked(0)).toBe(true);
  });
});

describe("finishing a step", () => {
  it("records it against the sound", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "meet" });
    });

    const row = backend.db.rows("user_sound_progress")[0];
    expect(row.sound_code).toBe(FIRST);
    expect(row.steps_completed).toEqual(["meet"]);
  });

  it("adds to the steps already done rather than replacing them", async () => {
    const { result, backend } = await render((b) => {
      b.db.seed("user_sound_progress", [
        aSoundRow(FIRST, { steps_completed: ["meet", "mouth"] }),
      ]);
    });

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "spell" });
    });

    // The write is an upsert of the whole row, so a replace here would erase
    // two steps the learner had already finished.
    expect(backend.db.rows("user_sound_progress")[0].steps_completed).toEqual([
      "meet",
      "mouth",
      "spell",
    ]);
  });

  it("keeps the steps in their taught order, not the order finished", async () => {
    const { result, backend } = await render((b) => {
      b.db.seed("user_sound_progress", [aSoundRow(FIRST, { steps_completed: ["contrast"] })]);
    });
    await waitFor(() => expect(result.current.progress[FIRST]).toBeTruthy());

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "meet" });
    });

    // The progress dots read left to right; storing them in completion order
    // would draw them scrambled.
    expect(backend.db.rows("user_sound_progress")[0].steps_completed).toEqual([
      "meet",
      "contrast",
    ]);
  });

  it("loses a step completed before the previous one has been read back", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "meet" });
      await result.current.completeStep({ soundCode: FIRST, step: "mouth" });
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
    expect(backend.db.rows("user_sound_progress")[0].steps_completed).toEqual(["mouth"]);
  });

  it("does the same step twice without duplicating it", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "meet" });
      await result.current.completeStep({ soundCode: FIRST, step: "meet" });
    });

    expect(backend.db.rows("user_sound_progress")[0].steps_completed).toEqual(["meet"]);
  });

  it("keeps the better of two scores", async () => {
    const { result, backend } = await render((b) => {
      b.db.seed("user_sound_progress", [
        aSoundRow(FIRST, { steps_completed: ["spot"], best_spot_score: 90 }),
      ]);
    });

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "spot", spotScore: 40 });
    });

    // "Best" has to mean best; overwriting turns practice into a way of losing
    // a score already earned.
    expect(Number(backend.db.rows("user_sound_progress")[0].best_spot_score)).toBe(90);
  });

  it("takes a better score when there is one", async () => {
    const { result, backend } = await render((b) => {
      b.db.seed("user_sound_progress", [
        aSoundRow(FIRST, { steps_completed: ["spot"], best_spot_score: 40 }),
      ]);
    });

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "spot", spotScore: 95 });
    });

    expect(Number(backend.db.rows("user_sound_progress")[0].best_spot_score)).toBe(95);
  });

  it("keeps the two scores apart", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "contrast", soundScore: 77 });
    });

    const row = backend.db.rows("user_sound_progress")[0];
    expect(Number(row.best_sound_score)).toBe(77);
    expect(Number(row.best_spot_score)).toBe(0);
  });

  it("masters the sound only on the last step", async () => {
    const partial = SOUND_STEPS.slice(0, -1);
    const { result, backend } = await render((b) => {
      b.db.seed("user_sound_progress", [
        aSoundRow(FIRST, { steps_completed: [...partial] }),
      ]);
    });

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: SOUND_STEPS.at(-1)! });
    });

    // Mastery is what unlocks the next sound, so declaring it early opens the
    // whole track and declaring it late strands the learner.
    expect(backend.db.rows("user_sound_progress")[0].mastered_at).toBeTruthy();
  });

  it("does not mark it mastered before then", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "meet" });
    });

    expect(backend.db.rows("user_sound_progress")[0].mastered_at).toBeNull();
  });

  it("keeps the date a sound was first mastered", async () => {
    const originally = new Date("2026-03-01T12:00:00Z").toISOString();
    const { result, backend } = await render((b) => {
      b.db.seed("user_sound_progress", [aMasteredSound(FIRST)]);
    });

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "spot", spotScore: 99 });
    });

    // Practising a mastered sound must not restamp it as newly learned; the
    // date is a record of when it happened.
    expect(backend.db.rows("user_sound_progress")[0].mastered_at).toBe(originally);
  });

  it("keeps one row per sound", async () => {
    const { result, backend } = await render();

    await act(async () => {
      await result.current.completeStep({ soundCode: FIRST, step: "meet" });
      await result.current.completeStep({ soundCode: SECOND, step: "meet" });
      await result.current.completeStep({ soundCode: FIRST, step: "mouth" });
    });

    // Upserted on (user_id, sound_code); two rows for one sound would give it
    // two different sets of completed steps.
    expect(backend.db.rows("user_sound_progress")).toHaveLength(2);
  });

  it("refuses to record anything when signed out", async () => {
    const harness = renderHookWithProviders(() => useSoundProgress(), {
      seed: (b) => b.db.seed("user_sound_progress", []),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await expect(
        harness.result.current.completeStep({ soundCode: FIRST, step: "meet" }),
      ).rejects.toThrow(/not signed in/i);
    });
    expect(harness.backend.db.rows("user_sound_progress")).toHaveLength(0);
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
