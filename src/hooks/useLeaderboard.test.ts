import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { aProfile, aUserXp } from "@/test/support/factories";
import { useAuth } from "./useAuth";
import {
  useAllTimeLeaderboard,
  useMyProfile,
  useMyRank,
  useUpdateProfile,
  useWeeklyLeaderboard,
} from "./useLeaderboard";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The leaderboard, and the profile behind it.
 *
 * Everything here is public to other learners, which makes the opt-out the most
 * important thing in the file: the list is built from `leaderboard_profiles`, a
 * view that exposes only display name and avatar and only for people who opted
 * in. Reading `profiles` directly instead would work perfectly and quietly
 * publish everyone.
 *
 * The board itself is assembled client-side from three queries — the view, XP,
 * and institutions — joined by user id, so a learner missing from one of them
 * has to degrade rather than disappear or crash.
 */

const RIVAL = "00000000-0000-4000-8000-0000000000c1";
const THIRD = "00000000-0000-4000-8000-0000000000c2";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** A row of the public view. Deliberately not a full profile. */
const aPublicProfile = (userId: string, over: Record<string, unknown> = {}) => ({
  user_id: userId,
  display_name: `Learner ${userId.slice(-2)}`,
  avatar_url: null,
  institution_id: null,
  custom_institution: null,
  show_institution: true,
  ...over,
});

function render<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(hook, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

/** Three learners on the board, with distinguishable weekly and lifetime XP. */
const seedBoard = (backend: SupabaseBackend) => {
  backend.db.seed("leaderboard_profiles", [
    aPublicProfile(TEST_USER_ID, { display_name: "Me" }),
    aPublicProfile(RIVAL, { display_name: "Rival" }),
    aPublicProfile(THIRD, { display_name: "Third" }),
  ]);
  backend.db.seed("user_xp", [
    aUserXp({ user_id: TEST_USER_ID, total_xp: 500, xp_this_week: 10, level: 3 }),
    aUserXp({ user_id: RIVAL, total_xp: 100, xp_this_week: 300, level: 2 }),
    aUserXp({ user_id: THIRD, total_xp: 900, xp_this_week: 50, level: 5 }),
  ]);
  backend.db.seed("institutions", []);
};

describe("the weekly board", () => {
  it("ranks by this week's XP", async () => {
    const { result } = render(() => useWeeklyLeaderboard(), seedBoard);

    await waitFor(() => expect(result.current.data).toHaveLength(3));
    // Lifetime order would be Third, Me, Rival — a board nobody new could ever
    // climb. The weekly number is what makes it a contest.
    expect(result.current.data?.map((row) => row.display_name)).toEqual([
      "Rival",
      "Third",
      "Me",
    ]);
  });

  it("numbers the ranks from one", async () => {
    const { result } = render(() => useWeeklyLeaderboard(), seedBoard);

    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(result.current.data?.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("honours the limit", async () => {
    const { result } = render(() => useWeeklyLeaderboard(2), seedBoard);

    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });

  it("only includes learners the public view exposes", async () => {
    const { result } = render(() => useWeeklyLeaderboard(), (backend) => {
      seedBoard(backend);
      // The view holds only those who opted in; someone who turned the setting
      // off is simply absent from it.
      backend.db.seed("leaderboard_profiles", [aPublicProfile(RIVAL, { display_name: "Rival" })]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    // Reading `profiles` and filtering in JavaScript would publish every learner
    // the moment the filter was mistyped. The view is the safeguard.
    expect(result.current.data?.[0].display_name).toBe("Rival");
  });

  it("is empty when nobody has opted in", async () => {
    const { result } = render(() => useWeeklyLeaderboard(), (backend) => {
      seedBoard(backend);
      backend.db.seed("leaderboard_profiles", []);
    });

    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("calls a learner with no display name مجهول", async () => {
    const { result } = render(() => useWeeklyLeaderboard(), (backend) => {
      seedBoard(backend);
      backend.db.seed("leaderboard_profiles", [
        aPublicProfile(RIVAL, { display_name: null }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    // A blank row is unreadable, and falling back to the user id would publish
    // an identifier nobody chose to share.
    expect(result.current.data?.[0].display_name).toBe("مجهول");
  });

  it("names a verified institution", async () => {
    const { result } = render(() => useWeeklyLeaderboard(), (backend) => {
      seedBoard(backend);
      backend.db.seed("leaderboard_profiles", [
        aPublicProfile(RIVAL, { display_name: "Rival", institution_id: "inst-1" }),
      ]);
      backend.db.seed("institutions", [{ id: "inst-1", name: "Gulf University", verified: true }]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].institution_name).toBe("Gulf University");
    expect(result.current.data?.[0].institution_verified).toBe(true);
  });

  it("shows a self-typed institution without the verified mark", async () => {
    const { result } = render(() => useWeeklyLeaderboard(), (backend) => {
      seedBoard(backend);
      backend.db.seed("leaderboard_profiles", [
        aPublicProfile(RIVAL, { display_name: "Rival", custom_institution: "Somewhere Else" }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    // Anyone can type anything here; marking it verified would make the badge
    // worthless on the rows where it matters.
    expect(result.current.data?.[0].institution_name).toBe("Somewhere Else");
    expect(result.current.data?.[0].institution_verified).toBe(false);
  });
});

describe("the all-time board", () => {
  it("ranks by lifetime XP", async () => {
    const { result } = render(() => useAllTimeLeaderboard(), seedBoard);

    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(result.current.data?.map((row) => row.display_name)).toEqual([
      "Third",
      "Me",
      "Rival",
    ]);
  });

  it("respects the same opt-out as the weekly board", async () => {
    const { result } = render(() => useAllTimeLeaderboard(), (backend) => {
      seedBoard(backend);
      backend.db.seed("leaderboard_profiles", [aPublicProfile(RIVAL, { display_name: "Rival" })]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });
});

describe("a learner's own rank", () => {
  it("counts how many are ahead, on both boards", async () => {
    const { result } = render(() => useMyRank(), seedBoard);

    await waitFor(() => expect(result.current.data).toBeTruthy());
    // Me: 500 lifetime (Third's 900 is ahead → 2nd), 10 this week (both ahead →
    // 3rd). Counted with an exact head query rather than by fetching the board,
    // so it is right even past the display limit.
    expect(result.current.data).toEqual({ weeklyRank: 3, allTimeRank: 2 });
  });

  it("reports first place as one, not zero", async () => {
    const { result } = render(() => useMyRank(), (backend) => {
      seedBoard(backend);
      backend.db.seed("user_xp", [
        aUserXp({ user_id: TEST_USER_ID, total_xp: 9999, xp_this_week: 9999 }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toEqual({ weeklyRank: 1, allTimeRank: 1 }));
  });

  it("counts everyone ahead, not only those on the board", async () => {
    const { result } = render(() => useMyRank(), (backend) => {
      seedBoard(backend);
      // Nobody opted in, so the visible board is empty — but the rank is still
      // a real position among everyone.
      backend.db.seed("leaderboard_profiles", []);
    });

    await waitFor(() => expect(result.current.data).toEqual({ weeklyRank: 3, allTimeRank: 2 }));
  });

  it("answers with nulls for a learner who has no XP row yet", async () => {
    const { result } = render(() => useMyRank(), (backend) => {
      seedBoard(backend);
      backend.db.seed("user_xp", [aUserXp({ user_id: RIVAL })]);
    });

    // Rank zero or rank one would both be wrong for someone who has not
    // started; null is what the UI hides on.
    await waitFor(() =>
      expect(result.current.data).toEqual({ weeklyRank: null, allTimeRank: null }),
    );
  });
});

describe("the learner's own profile", () => {
  it("returns the existing row", async () => {
    const { result } = render(() => useMyProfile(), (backend) => {
      backend.db.seed("profiles", [aProfile({ display_name: "Sami" })]);
    });

    await waitFor(() => expect(result.current.data?.display_name).toBe("Sami"));
  });

  it("creates one from the email prefix when there is none", async () => {
    const { result, backend } = render(() => useMyProfile(), (b) => b.db.seed("profiles", []));

    await waitFor(() => expect(result.current.data).toBeTruthy());
    // A learner with no profile row would otherwise be invisible everywhere —
    // no leaderboard entry, no name on a friend's list — with nothing to
    // explain why.
    expect(backend.db.rows("profiles")).toHaveLength(1);
    expect(result.current.data?.display_name).toBe("e2e");
  });

  it("updates only the learner's own row", async () => {
    const harness = renderHookWithProviders(
      () => ({ hook: useUpdateProfile(), user: useAuth().user }),
      {
        persona: "free",
        seed: (backend) => {
          backend.db.seed("profiles", [
            aProfile({ display_name: "Mine" }),
            aProfile({ user_id: RIVAL, display_name: "Theirs" }),
          ]);
        },
      },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.user).toBeTruthy());

    await act(async () => {
      await harness.result.current.hook.mutateAsync({ display_name: "Renamed" });
    });

    const rows = harness.backend.db.rows("profiles");
    expect(rows.find((row) => row.user_id === TEST_USER_ID)?.display_name).toBe("Renamed");
    // An update without its filter would rename every learner in the app.
    expect(rows.find((row) => row.user_id === RIVAL)?.display_name).toBe("Theirs");
  });

  it("refuses to update when signed out", async () => {
    const harness = renderHookWithProviders(() => useUpdateProfile(), {
      seed: (backend) => backend.db.seed("profiles", []),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await expect(
        harness.result.current.mutateAsync({ display_name: "Anyone" }),
      ).rejects.toThrow(/not authenticated/i);
    });
  });
});
