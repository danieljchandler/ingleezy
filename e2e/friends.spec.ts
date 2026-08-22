import { expect, test } from "./support/fixtures";
import { aProfile, aUserXp, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * Friends — following, searching and challenging other learners.
 *
 * There is no join here. `useFriendsActivity` reads four tables separately and
 * stitches them in JavaScript, keyed on the list of ids it followed first. That
 * shape decides how the page fails: a *missing row* degrades to a default
 * (level 1, no streak, zero XP), while a *failing query* takes the whole list
 * down, because every one of the four rethrows. Both are worth pinning, since
 * from the page they look nothing alike.
 *
 * The other thing this spec exists for is `review_streaks`. For a long time it
 * was a table the app read that no migration created (it existed only in
 * production, with award_xp writing it since 20260822); it has a real
 * migration now, but it remains a hard dependency here: if that read fails,
 * nobody has any friends.
 */

const FRIEND = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";

const aFollow = (followingId: string, followerId = TEST_USER_ID) => ({
  id: `eeeeeeee-0000-4000-8000-${followingId.slice(-12)}`,
  follower_id: followerId,
  following_id: followingId,
  created_at: new Date().toISOString(),
});

const aStreak = (userId: string, current = 0) => ({
  id: `ffffffff-0000-4000-8000-${userId.slice(-12)}`,
  user_id: userId,
  current_streak: current,
  longest_streak: current,
  last_review_date: new Date().toISOString().slice(0, 10),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

/** One friend, fully populated across all four tables. */
function seedOneFriend(db: MemoryDb) {
  db.seed("user_follows", [aFollow(FRIEND)]);
  db.seed("profiles", [
    aProfile(),
    aProfile({ user_id: FRIEND, display_name: "Layla" }),
  ]);
  db.seed("user_xp", [
    aUserXp(),
    aUserXp({ user_id: FRIEND, level: 4, xp_this_week: 320, total_xp: 4000 }),
  ]);
  db.seed("review_streaks", [aStreak(FRIEND, 12)]);
  db.seed("challenges", []);
  db.seed("video_likes", []);
  db.seed("discover_videos", []);
}

test.describe("reaching the page", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/friends");

    await expect(page).toHaveURL(/\/auth/);
  });

  test("never reaches the page's own signed-out screen", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/friends");
    await expect(page).toHaveURL(/\/auth/);

    // Friends.tsx opens with an `if (!isAuthenticated)` branch rendering a
    // "Sign in to see friends" card, but the route is wrapped in
    // ProtectedRoute, which redirects first — so that whole branch is dead.
    // Harmless today, misleading tomorrow: it reads as though the page handles
    // signed-out visitors, and anyone relaxing the route guard on that basis
    // would be relying on a screen nobody has ever seen.
    await expect(page.getByText("Sign in to see friends")).toHaveCount(0);
  });
});

test.describe("the following list", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows a followed learner with their level, streak and weekly XP", async ({ page, db }) => {
    seedOneFriend(db);

    await page.goto("/friends");

    await expect(page.getByText("Layla")).toBeVisible();
    await expect(page.getByText("Level 4")).toBeVisible();
    await expect(page.getByText("12")).toBeVisible();
    await expect(page.getByText("320")).toBeVisible();
  });

  test("counts the people being followed", async ({ page, db }) => {
    seedOneFriend(db);
    db.add("user_follows", aFollow(OTHER));
    db.add("profiles", aProfile({ user_id: OTHER, display_name: "Omar" }));
    db.add("user_xp", aUserXp({ user_id: OTHER }));
    db.add("review_streaks", aStreak(OTHER, 3));

    await page.goto("/friends");

    await expect(page.getByText("Following (2)")).toBeVisible();
  });

  test("puts whoever earned most this week first", async ({ page, db }) => {
    seedOneFriend(db);
    db.add("user_follows", aFollow(OTHER));
    db.add("profiles", aProfile({ user_id: OTHER, display_name: "Omar" }));
    db.add("user_xp", aUserXp({ user_id: OTHER, xp_this_week: 900 }));
    db.add("review_streaks", aStreak(OTHER));

    await page.goto("/friends");
    await expect(page.getByText("Omar")).toBeVisible();

    // The sort is the whole point of the weekly number — it is a leaderboard
    // among people you chose, not a directory.
    const names = await page.locator("p.font-semibold.truncate").allTextContents();
    expect(names).toEqual(["Omar", "Layla"]);
  });

  test("points an empty list at the search box", async ({ page, db }) => {
    db.seed("user_follows", []);
    db.seed("challenges", []);

    await page.goto("/friends");

    await expect(page.getByText("لا تتابع أحداً بعد")).toBeVisible();
    await expect(page.getByPlaceholder("ابحث عن مستخدمين بالاسم...")).toBeVisible();
  });

  test("falls back to Anonymous for a learner with no display name", async ({ page, db }) => {
    seedOneFriend(db);
    db.seed("profiles", [aProfile(), aProfile({ user_id: FRIEND, display_name: null })]);

    await page.goto("/friends");

    await expect(page.getByText("مجهول")).toBeVisible();
  });

  test("still lists someone who has no XP row yet", async ({ page, db }) => {
    seedOneFriend(db);
    db.seed("user_xp", [aUserXp()]);

    await page.goto("/friends");

    // A learner who has never earned XP has no row, which is not the same as an
    // error. The merge defaults rather than dropping them from the list.
    await expect(page.getByText("Layla")).toBeVisible();
    await expect(page.getByText("Level 1")).toBeVisible();
  });

  test("hides the flame for someone with no streak", async ({ page, db }) => {
    seedOneFriend(db);
    db.seed("review_streaks", [aStreak(FRIEND, 0)]);

    await page.goto("/friends");
    await expect(page.getByText("Layla")).toBeVisible();

    await expect(page.locator(".text-orange-500")).toHaveCount(0);
  });

  test("loses every friend when the streak table cannot be read", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedOneFriend(db);
    db.failAlways("review_streaks", 500);

    await page.goto("/friends");

    // The query rethrows rather than defaulting the streak to zero, so the
    // decorative number is load-bearing: losing it empties the list and the
    // page says the learner follows nobody.
    await expect(page.getByText("لا تتابع أحداً بعد")).toBeVisible();
    await expect(page.getByText("Layla")).toHaveCount(0);
  });
});

test.describe("finding someone to follow", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("user_follows", []);
    db.seed("challenges", []);
    db.seed("video_likes", []);
    db.seed("discover_videos", []);
    db.seed("review_streaks", []);
    db.seed("user_xp", [aUserXp(), aUserXp({ user_id: OTHER, level: 7 })]);
    db.seed("profiles", [
      aProfile(),
      aProfile({ user_id: OTHER, display_name: "Omar", show_on_leaderboard: true }),
    ]);
  });

  test("waits for more than one character before searching", async ({ page, db }) => {
    await page.goto("/friends");
    await page.getByPlaceholder("ابحث عن مستخدمين بالاسم...").fill("O");

    // A single letter matches most of the user table; the floor is what stops
    // the search box from being a directory dump.
    await expect(page.getByText("نتائج البحث")).toHaveCount(0);
    expect(db.readsOf("profiles").filter((r) => r.search.includes("ilike"))).toHaveLength(0);
  });

  test("finds a learner by part of their name", async ({ page }) => {
    await page.goto("/friends");
    await page.getByPlaceholder("ابحث عن مستخدمين بالاسم...").fill("oma");

    await expect(page.getByText("نتائج البحث")).toBeVisible();
    await expect(page.getByText("Omar")).toBeVisible();
    await expect(page.getByText("Level 7")).toBeVisible();
  });

  test("says so when nobody matches", async ({ page }) => {
    await page.goto("/friends");
    await page.getByPlaceholder("ابحث عن مستخدمين بالاسم...").fill("zzzz");

    await expect(page.getByText("لم نجد مستخدمين")).toBeVisible();
  });

  test("leaves out anyone who opted off the leaderboard", async ({ page, db }) => {
    db.seed("profiles", [
      aProfile(),
      aProfile({ user_id: OTHER, display_name: "Omar", show_on_leaderboard: false }),
    ]);

    await page.goto("/friends");
    await page.getByPlaceholder("ابحث عن مستخدمين بالاسم...").fill("oma");

    // The same switch that hides someone from the leaderboard makes them
    // unsearchable — one opt-out covers being found as well as being ranked.
    await expect(page.getByText("لم نجد مستخدمين")).toBeVisible();
  });

  test("never returns the searcher themselves", async ({ page, db }) => {
    db.seed("profiles", [
      aProfile({ display_name: "Omar Prime" }),
      aProfile({ user_id: OTHER, display_name: "Omar", show_on_leaderboard: true }),
    ]);

    await page.goto("/friends");
    await page.getByPlaceholder("ابحث عن مستخدمين بالاسم...").fill("omar");

    await expect(page.getByText("Omar", { exact: true })).toBeVisible();
    await expect(page.getByText("Omar Prime")).toHaveCount(0);
  });

  test("follows a learner from the results", async ({ page, db }) => {
    await page.goto("/friends");
    await page.getByPlaceholder("ابحث عن مستخدمين بالاسم...").fill("oma");
    await expect(page.getByText("Omar")).toBeVisible();

    await page.getByRole("button", { name: "متابعة" }).click();

    await expect(page.getByText("تتابعه الآن!")).toBeVisible();
    await expect.poll(() => db.rows("user_follows").length).toBe(1);
    expect(db.rows("user_follows")[0]).toMatchObject({
      follower_id: TEST_USER_ID,
      following_id: OTHER,
    });
  });

  test("unfollows from the friends list", async ({ page, db }) => {
    seedOneFriend(db);

    await page.goto("/friends");
    await expect(page.getByText("Layla")).toBeVisible();

    await page.getByRole("button", { name: "إلغاء المتابعة" }).click();

    await expect(page.getByText("ألغيت المتابعة")).toBeVisible();
    await expect.poll(() => db.rows("user_follows").length).toBe(0);
  });

  test("reports a follow that did not stick", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    db.failWrites("user_follows", 500);

    await page.goto("/friends");
    await page.getByPlaceholder("ابحث عن مستخدمين بالاسم...").fill("oma");
    await page.getByRole("button", { name: "متابعة" }).click();

    await expect(page.getByText("تعذّر تحديث المتابعة")).toBeVisible();
  });

  test("catches up on who is followed when the follow list loads late", async ({ page, db }) => {
    db.seed("user_follows", [aFollow(OTHER)]);
    db.seed("review_streaks", [aStreak(OTHER)]);
    db.delay("user_follows", 2500);

    await page.goto("/friends");
    await page.getByPlaceholder("ابحث عن مستخدمين بالاسم...").fill("oma");
    await expect(page.getByText("Omar")).toBeVisible();

    // `is_following` used to be computed inside the search `queryFn` from
    // `useFollowing()`, which is neither in that query's key nor one of its
    // dependencies — so whichever resolved first decided, permanently, and
    // React Query had no reason to recompute. With the follow list slow, every
    // result read "not following" and pressing Follow wrote a duplicate row.
    // It is derived outside the query now, so it catches up.
    await expect(page.getByRole("button", { name: "إلغاء المتابعة" })).toBeVisible();
    await expect(page.getByRole("button", { name: "متابعة", exact: true })).toHaveCount(0);
  });
});

test.describe("challenges", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("offers a challenge against someone already followed", async ({ page, db }) => {
    seedOneFriend(db);

    await page.goto("/friends");
    await expect(page.getByText("Layla")).toBeVisible();

    // Located by icon: the swords button carries no accessible name, so a
    // screen reader announces it as "button". Counted against the app-wide
    // icon-button a11y baseline rather than worked around silently.
    await expect(page.locator("button:has(svg.lucide-swords)")).toHaveCount(1);
  });

  test("offers no challenge against a stranger in the search results", async ({ page, db }) => {
    db.seed("user_follows", []);
    db.seed("challenges", []);
    db.seed("review_streaks", []);
    db.seed("user_xp", [aUserXp(), aUserXp({ user_id: OTHER })]);
    db.seed("profiles", [
      aProfile(),
      aProfile({ user_id: OTHER, display_name: "Omar", show_on_leaderboard: true }),
    ]);

    await page.goto("/friends");
    await page.getByPlaceholder("ابحث عن مستخدمين بالاسم...").fill("oma");
    await expect(page.getByText("Omar")).toBeVisible();

    // A challenge is a commitment between two people who have opted in; the
    // Follow button is the step before it.
    await expect(page.locator("button:has(svg.lucide-swords)")).toHaveCount(0);
  });

  test("opens the challenge dialog against the right learner", async ({ page, db }) => {
    seedOneFriend(db);

    await page.goto("/friends");
    await expect(page.getByText("Layla")).toBeVisible();
    await page.locator("button:has(svg.lucide-swords)").click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText(/Layla/)).toBeVisible();
  });

  test("shows an incoming challenge waiting to be answered", async ({ page, db }) => {
    seedOneFriend(db);
    db.seed("challenges", [
      {
        id: "aaaaaaaa-1111-4000-8000-000000000000",
        challenger_id: FRIEND,
        challenged_id: TEST_USER_ID,
        status: "pending",
        challenge_type: "xp",
        target_xp: 100,
        duration_days: 7,
        challenger_progress: 0,
        challenged_progress: 0,
        winner_id: null,
        completed_at: null,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        created_at: new Date().toISOString(),
      },
    ]);

    await page.goto("/friends");

    await expect(page.getByText("تحديات واردة")).toBeVisible();
  });

  test("keeps a challenge the learner sent out of the incoming pile", async ({ page, db }) => {
    seedOneFriend(db);
    db.seed("challenges", [
      {
        id: "aaaaaaaa-1111-4000-8000-000000000000",
        challenger_id: TEST_USER_ID,
        challenged_id: FRIEND,
        status: "pending",
        challenge_type: "xp",
        target_xp: 100,
        duration_days: 7,
        challenger_progress: 0,
        challenged_progress: 0,
        winner_id: null,
        completed_at: null,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        created_at: new Date().toISOString(),
      },
    ]);

    await page.goto("/friends");
    await expect(page.getByText("Layla")).toBeVisible();

    // Both sides read the same table, so the filter on `challenged_id` is the
    // only thing stopping a learner being offered Accept/Decline on their own
    // challenge.
    await expect(page.getByText("تحديات واردة")).toHaveCount(0);
  });
});
