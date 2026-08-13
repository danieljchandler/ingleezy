import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aProfile, TEST_USER_ID } from "@/test/support/factories";
import { useUserLevel } from "./useUserLevel";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The learner's placement level, and the difficulty every generator is given.
 *
 * Almost every AI call in the app carries this label — story generation,
 * listening quizzes, the daily challenge, dialect drills — so it is the single
 * value deciding how hard the app is. It is also the only input to that
 * decision, which means a wrong answer here is not one bad card but a
 * consistently mispitched app that a learner has no control over.
 *
 * Placement is per dialect, because being B1 in Gulf says nothing about
 * Egyptian, with a legacy single-dialect column still holding the level for
 * anyone who placed before that split.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function render(profile?: Record<string, unknown> | null, dialect = "Gulf") {
  // DialectContext seeds itself from localStorage and then re-syncs from
  // `profiles.preferred_dialect` on mount, so both have to agree or the
  // provider snaps back to whatever the row says.
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const seed = (backend: SupabaseBackend) => {
    backend.db.seed(
      "profiles",
      profile === null
        ? []
        : [aProfile({ user_id: TEST_USER_ID, preferred_dialect: dialect, ...profile })],
    );
  };
  const harness = renderHookWithProviders(() => useUserLevel(), {
    persona: "free",
    seed,
  });
  cleanup = harness.cleanup;
  return harness;
}

describe("reading the level", () => {
  it("uses the placement for the active dialect", async () => {
    const { result } = render({ placement_level_gulf: "B1", placement_level_egyptian: "A1" });

    await waitFor(() => expect(result.current.placementLevel).toBe("B1"));
    expect(result.current.hasTakenPlacement).toBe(true);
  });

  it("reads a different level for a different dialect", async () => {
    const { result } = render(
      { placement_level_gulf: "B1", placement_level_egyptian: "C1" },
      "Egyptian",
    );

    // Being intermediate in Gulf says nothing about Egyptian; sharing one level
    // pitches half the app wrong for anyone studying two.
    await waitFor(() => expect(result.current.placementLevel).toBe("C1"));
  });

  it("falls back to the legacy single-dialect column", async () => {
    const { result } = render({ placement_level: "B2", placement_level_gulf: null });

    // Anyone who placed before per-dialect tracking has only this column;
    // ignoring it would reset them all to beginner.
    await waitFor(() => expect(result.current.placementLevel).toBe("B2"));
  });

  it("prefers the per-dialect level over the legacy one", async () => {
    const { result } = render({ placement_level: "A1", placement_level_gulf: "C1" });

    await waitFor(() => expect(result.current.placementLevel).toBe("C1"));
  });

  it("reports no placement when neither column is set", async () => {
    const { result } = render({ placement_level: null, placement_level_gulf: null });

    await waitFor(() => expect(result.current.hasTakenPlacement).toBe(false));
    expect(result.current.placementLevel).toBeNull();
  });

  it("reports no placement when the profile row is missing", async () => {
    const { result } = render(null);

    // A profile row that has not been created yet is the state a brand-new
    // account is in for its first few seconds.
    await waitFor(() => expect(result.current.hasTakenPlacement).toBe(false));
  });
});

describe("mapping to a difficulty", () => {
  const cases: Array<[string, string]> = [
    ["A1", "beginner"],
    ["A2", "beginner"],
    ["B1", "intermediate"],
    ["B2", "intermediate"],
    ["C1", "advanced"],
    ["C2", "advanced"],
  ];

  for (const [level, difficulty] of cases) {
    it(`calls ${level} ${difficulty}`, async () => {
      const { result } = render({ placement_level_gulf: level });

      await waitFor(() => expect(result.current.difficulty).toBe(difficulty));
    });
  }

  it("accepts a lowercase level from an older write", async () => {
    const { result } = render({ placement_level_gulf: "b1" });

    // The mapping upper-cases first; without that, every lowercase level would
    // fall through to beginner.
    await waitFor(() => expect(result.current.difficulty).toBe("intermediate"));
  });

  it("treats an unplaced learner as a beginner", async () => {
    const { result } = render({ placement_level: null, placement_level_gulf: null });

    // The safe direction: content that is too easy is a mild annoyance, content
    // that is too hard is where people give up.
    await waitFor(() => expect(result.current.difficulty).toBe("beginner"));
  });

  it("treats a level it does not recognise as beginner", async () => {
    const { result } = render({ placement_level_gulf: "Fluent" });

    // Wait for the profile itself, not for the difficulty — "beginner" is also
    // what the hook reports while the query is still in flight.
    await waitFor(() => expect(result.current.placementLevel).toBe("Fluent"));

    // Pinned. A level outside the CEFR set — from a hand-edited row or a
    // future scale — silently becomes beginner rather than surfacing. The
    // learner sees an app that got easier with no explanation, and
    // `hasTakenPlacement` still reports true, so nothing prompts a retake.
    expect(result.current.difficulty).toBe("beginner");
    expect(result.current.hasTakenPlacement).toBe(true);
  });
});
