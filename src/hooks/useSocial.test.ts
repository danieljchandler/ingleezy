import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { aProfile, aUserXp } from "@/test/support/factories";
import { useAuth } from "./useAuth";
import {
  useFollowUser,
  useFollowers,
  useFollowing,
  useFriendsActivity,
  useMyChallenges,
  useSearchUsers,
  useUnfollowUser,
} from "./useSocial";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Following, searching and the friends list.
 *
 * The friends list is assembled client-side from four separate queries —
 * follows, profiles, XP and streaks — joined in JavaScript by user id. That
 * shape is why it needs tests: nothing in the type system connects the four,
 * so a learner whose XP row is missing has to appear with zeroes rather than
 * disappearing from the list, and one whose streak table row is absent must not
 * take the whole list down.
 *
 * `review_streaks` is one of the three tables that exist in production but in
 * no migration in this repo, which makes it the likeliest of the four to be
 * missing on a rebuilt database — so what happens when it fails is worth
 * pinning explicitly rather than discovering later.
 */

const FRIEND = "00000000-0000-4000-8000-0000000000f1";
const OTHER = "00000000-0000-4000-8000-0000000000f2";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const follow = (follower: string, following: string, id = `${follower}-${following}`) => ({
  id,
  follower_id: follower,
  following_id: following,
  created_at: new Date().toISOString(),
});

function render<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(hook, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

/**
 * Render a mutation hook and wait for the session.
 *
 * These mutations throw "Not authenticated" when `useAuth` has not resolved,
 * which it has not on the first render — so calling one immediately fails for a
 * reason that has nothing to do with what is under test.
 */
async function renderMutation<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(
    () => ({ hook: hook(), user: useAuth().user }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.user).toBeTruthy());
  return harness;
}

describe("who a learner follows", () => {
  it("lists the accounts they follow", async () => {
    const { result } = render(() => useFollowing(), (backend) => {
      backend.db.seed("user_follows", [
        follow(TEST_USER_ID, FRIEND),
        follow(TEST_USER_ID, OTHER),
      ]);
    });

    await waitFor(() => expect(result.current.data).toEqual([FRIEND, OTHER]));
  });

  it("does not confuse following with being followed", async () => {
    const { result } = render(() => useFollowing(), (backend) => {
      backend.db.seed("user_follows", [
        follow(TEST_USER_ID, FRIEND),
        // Someone follows the learner; that is a different relationship.
        follow(OTHER, TEST_USER_ID),
      ]);
    });

    await waitFor(() => expect(result.current.data).toEqual([FRIEND]));
  });

  it("lists the accounts following them", async () => {
    const { result } = render(() => useFollowers(), (backend) => {
      backend.db.seed("user_follows", [
        follow(TEST_USER_ID, FRIEND),
        follow(OTHER, TEST_USER_ID),
      ]);
    });

    await waitFor(() => expect(result.current.data).toEqual([OTHER]));
  });

  it("asks nothing for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useFollowing(), {
      seed: (backend) => backend.db.seed("user_follows", [follow(TEST_USER_ID, FRIEND)]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
    expect(harness.backend.db.readsOf("user_follows")).toHaveLength(0);
  });
});

describe("the friends list", () => {
  const seedFriend = (backend: SupabaseBackend, over: Record<string, unknown> = {}) => {
    backend.db.seed("user_follows", [follow(TEST_USER_ID, FRIEND)]);
    backend.db.add("profiles", aProfile({ user_id: FRIEND, display_name: "Layla" }));
    backend.db.add(
      "user_xp",
      aUserXp({ user_id: FRIEND, xp_this_week: 120, total_xp: 900, level: 4 }),
    );
    backend.db.seed("review_streaks", [{ user_id: FRIEND, current_streak: 12 }]);
    Object.assign(backend, over);
  };

  it("joins the profile, XP and streak for each friend", async () => {
    const { result } = render(() => useFriendsActivity(), seedFriend);

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0]).toMatchObject({
      user_id: FRIEND,
      display_name: "Layla",
      xp_this_week: 120,
      total_xp: 900,
      level: 4,
      current_streak: 12,
    });
  });

  it("is empty when nobody is followed", async () => {
    const { result } = render(() => useFriendsActivity(), (backend) => {
      backend.db.seed("user_follows", []);
    });

    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("ranks by this week's XP, not lifetime", async () => {
    const { result } = render(() => useFriendsActivity(), (backend) => {
      backend.db.seed("user_follows", [
        follow(TEST_USER_ID, FRIEND),
        follow(TEST_USER_ID, OTHER),
      ]);
      backend.db.add("profiles", aProfile({ user_id: FRIEND, display_name: "Layla" }));
      backend.db.add("profiles", aProfile({ user_id: OTHER, display_name: "Sami" }));
      // Sami has more lifetime XP but has done less this week.
      backend.db.add("user_xp", aUserXp({ user_id: FRIEND, xp_this_week: 300, total_xp: 400 }));
      backend.db.add("user_xp", aUserXp({ user_id: OTHER, xp_this_week: 50, total_xp: 9000 }));
      backend.db.seed("review_streaks", []);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    // A leaderboard of lifetime totals is a leaderboard nobody new can ever
    // climb; the weekly number is what makes it a contest.
    expect(result.current.data?.map((friend) => friend.display_name)).toEqual(["Layla", "Sami"]);
  });

  it("keeps a friend with no XP row, at zero", async () => {
    const { result } = render(() => useFriendsActivity(), (backend) => {
      backend.db.seed("user_follows", [follow(TEST_USER_ID, FRIEND)]);
      backend.db.add("profiles", aProfile({ user_id: FRIEND, display_name: "Layla" }));
      backend.db.seed("user_xp", []);
      backend.db.seed("review_streaks", []);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    // A learner who has followed someone who has not started yet should see
    // them sitting at zero, not have them vanish from a list they built.
    expect(result.current.data?.[0]).toMatchObject({
      display_name: "Layla",
      xp_this_week: 0,
      level: 1,
      current_streak: 0,
    });
  });

  it("keeps a friend with no profile row", async () => {
    const { result } = render(() => useFriendsActivity(), (backend) => {
      backend.db.seed("user_follows", [follow(TEST_USER_ID, FRIEND)]);
      backend.db.seed("profiles", []);
      backend.db.seed("user_xp", []);
      backend.db.seed("review_streaks", []);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].display_name).toBeNull();
  });

  it("loses the whole list when the streaks table is unavailable", async () => {
    const { result } = render(() => useFriendsActivity(), (backend) => {
      backend.db.seed("user_follows", [follow(TEST_USER_ID, FRIEND)]);
      backend.db.add("profiles", aProfile({ user_id: FRIEND, display_name: "Layla" }));
      backend.db.add("user_xp", aUserXp({ user_id: FRIEND }));
      backend.db.failAlways("review_streaks", 500);
    });

    // Recording current behaviour. The streak query throws rather than
    // degrading, so a missing `review_streaks` — the one table of the four that
    // no migration in this repo creates — takes the entire friends list with
    // it, name, XP and all. The other three joins already tolerate a missing
    // row and fall back to a default.
    //
    // This test fails once the streak lookup is made best-effort like its
    // neighbours.
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("finding someone to follow", () => {
  const seedSearchable = (backend: SupabaseBackend) => {
    backend.db.add(
      "profiles",
      aProfile({ user_id: FRIEND, display_name: "Layla", show_on_leaderboard: true }),
    );
    backend.db.add(
      "profiles",
      aProfile({ user_id: OTHER, display_name: "Sami", show_on_leaderboard: true }),
    );
    backend.db.seed("user_follows", []);
    backend.db.seed("user_xp", []);
  };

  it("matches part of a display name, ignoring case", async () => {
    const { result } = render(() => useSearchUsers("lay"), seedSearchable);

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].display_name).toBe("Layla");
  });

  it("waits for enough to search on", async () => {
    const { result, backend } = render(() => useSearchUsers("l"), seedSearchable);

    // One letter would match most of the user base and cost a query per
    // keystroke, so the query stays disabled below two characters. Counted as
    // "no ilike search", because other hooks read `profiles` on mount for
    // reasons of their own.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(backend.db.readsOf("profiles").some((read) => read.search.includes("ilike"))).toBe(
      false,
    );
  });

  it("excludes the learner from their own results", async () => {
    const { result } = render(() => useSearchUsers("test"), (backend) => {
      seedSearchable(backend);
      backend.db.add(
        "profiles",
        aProfile({ user_id: TEST_USER_ID, display_name: "Tester", show_on_leaderboard: true }),
      );
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.some((row) => row.user_id === TEST_USER_ID)).toBe(false);
  });

  it("excludes anyone who opted out of the leaderboard", async () => {
    const { result } = render(() => useSearchUsers("sam"), (backend) => {
      seedSearchable(backend);
      backend.db.seed("profiles", [
        aProfile({ user_id: OTHER, display_name: "Sami", show_on_leaderboard: false }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The setting is a privacy choice; a search that ignored it would publish
    // exactly the name the learner asked to hide.
    expect(result.current.data).toEqual([]);
  });

  it("does not mark an already-followed account when the search wins the race", async () => {
    const { result } = render(() => useSearchUsers("lay"), (backend) => {
      seedSearchable(backend);
      backend.db.seed("user_follows", [follow(TEST_USER_ID, FRIEND)]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    // Recording current behaviour. `is_following` is computed inside the search
    // queryFn from `useFollowing()`, but the follow list is in neither the
    // query key nor any dependency — so when the two queries start together and
    // the search resolves first, the result is marked unfollowed and nothing
    // ever revises it. The learner is then offered a Follow button for someone
    // they already follow, and pressing it fails on the unique constraint.
    //
    // It usually looks fine because the follow list is normally cached by the
    // time anyone types. A cold load of /friends with a search is where it bites.
    //
    // This test fails once the follow list is part of the search's key.
    expect(result.current.data?.[0].is_following).toBe(false);
  });

  it("marks an already-followed account once the follow list is already cached", async () => {
    // Mount the follow list on its own first and let it settle, then start
    // searching against the same query client. That is the warm path — a
    // learner opens /friends, the list loads, and only then do they type.
    const harness = renderHookWithProviders(
      ({ term }: { term: string }) => {
        useFollowing();
        return useSearchUsers(term);
      },
      {
        persona: "free",
        initialProps: { term: "" },
        seed: (backend) => {
          seedSearchable(backend);
          backend.db.seed("user_follows", [follow(TEST_USER_ID, FRIEND)]);
        },
      },
    );
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.backend.db.readsOf("user_follows").length).toBeGreaterThan(0));
    harness.rerender({ term: "lay" });

    await waitFor(() => expect(harness.result.current.data?.[0]?.is_following).toBe(true));
  });
});

describe("following and unfollowing", () => {
  it("records the follow in the right direction", async () => {
    const { result, backend } = await renderMutation(() => useFollowUser(), (b) =>
      b.db.seed("user_follows", []),
    );

    await act(async () => {
      await result.current.hook.mutateAsync(FRIEND);
    });

    const row = backend.db.rows("user_follows")[0];
    // Reversing these two makes the learner a follower of nobody and a
    // follower of themselves to everyone else.
    expect(row.follower_id).toBe(TEST_USER_ID);
    expect(row.following_id).toBe(FRIEND);
  });

  it("removes exactly the follow asked for", async () => {
    const { result, backend } = await renderMutation(() => useUnfollowUser(), (b) =>
      b.db.seed("user_follows", [
        follow(TEST_USER_ID, FRIEND),
        follow(TEST_USER_ID, OTHER),
        follow(OTHER, TEST_USER_ID),
      ]),
    );

    await act(async () => {
      await result.current.hook.mutateAsync(FRIEND);
    });

    // Filtered on both columns: dropping either one would unfollow everybody,
    // or drop somebody else's follow of the learner.
    const remaining = backend.db.rows("user_follows");
    expect(remaining).toHaveLength(2);
    expect(remaining.some((row) => row.following_id === FRIEND)).toBe(false);
  });

  it("refuses to follow when signed out", async () => {
    const harness = renderHookWithProviders(() => useFollowUser(), {
      seed: (b) => b.db.seed("user_follows", []),
    });
    cleanup = harness.cleanup;

    // Asserted inside `act` rather than around it: a rejection escaping the act
    // scope leaves React's internal queue flagged, and the next test in the
    // file renders a tree whose result is null.
    await act(async () => {
      await expect(harness.result.current.mutateAsync(FRIEND)).rejects.toThrow(/not authenticated/i);
    });
    expect(harness.backend.db.rows("user_follows")).toHaveLength(0);
  });
});

describe("challenges", () => {
  const aChallenge = (over: Record<string, unknown> = {}) => ({
    id: "challenge-1",
    challenger_id: TEST_USER_ID,
    challenged_id: FRIEND,
    challenge_type: "xp_race",
    target_xp: 100,
    duration_days: 7,
    status: "pending",
    challenger_progress: 0,
    challenged_progress: 0,
    winner_id: null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    completed_at: null,
    ...over,
  });

  it("shows challenges the learner issued and ones issued to them", async () => {
    const { result } = render(() => useMyChallenges(), (backend) => {
      backend.db.seed("challenges", [
        aChallenge(),
        aChallenge({ id: "challenge-2", challenger_id: FRIEND, challenged_id: TEST_USER_ID }),
        // Someone else's challenge entirely.
        aChallenge({ id: "challenge-3", challenger_id: FRIEND, challenged_id: OTHER }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.map((row) => row.id).sort()).toEqual([
      "challenge-1",
      "challenge-2",
    ]);
  });
});
