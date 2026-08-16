import { expect, test } from "./support/fixtures";
import { aProfile, aUserXp, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The leaderboard, and the opt-out in front of it.
 *
 * Ranking learners against each other means publishing their names, so the
 * query does not read `profiles` at all — it reads `leaderboard_profiles`, a
 * view that exposes only display name and avatar and only for people who left
 * `show_on_leaderboard` on. That indirection is the privacy control, and the
 * tests treat it as one: what the view withholds must not appear, however the
 * page is reached.
 *
 * The ordering is done twice over — the XP query sorts and limits, then
 * `buildEntries` numbers the rows it got back — so rank is a property of the
 * response rather than of the data. Anything that changes what comes back
 * changes the numbers beside people's names.
 */

const RIVAL = "00000000-0000-4000-8000-0000000000b1";
const THIRD = "00000000-0000-4000-8000-0000000000b2";
const QUIET = "00000000-0000-4000-8000-0000000000b3";

const anInstitution = (over: Record<string, unknown> = {}) => ({
  id: "11111111-0000-4000-8000-000000000000",
  name: "Qatar University",
  verified: true,
  created_at: new Date().toISOString(),
  ...over,
});

/**
 * Seed a board.
 *
 * `leaderboard_profiles` is a view over `profiles`, and the emulator has no
 * view machinery — so each spec seeds the view directly with exactly the rows
 * the view would have produced. Everyone seeded here is opted in by
 * construction; the opt-out is exercised by leaving someone out of it, which is
 * precisely what the view does in production.
 */
function seedBoard(db: MemoryDb, rows: Array<Record<string, unknown>>) {
  db.seed(
    "leaderboard_profiles",
    rows.map((row) => ({
      user_id: row.user_id,
      display_name: row.display_name ?? null,
      avatar_url: null,
      institution_id: row.institution_id ?? null,
      custom_institution: row.custom_institution ?? null,
      show_institution: row.show_institution ?? true,
    })),
  );
  db.seed(
    "user_xp",
    rows.map((row) =>
      aUserXp({
        user_id: row.user_id,
        total_xp: row.total_xp ?? 0,
        xp_this_week: row.xp_this_week ?? 0,
        level: row.level ?? 1,
      }),
    ),
  );
  db.seed("institutions", []);
  db.seed("profiles", [aProfile()]);
}

test.describe("who can see the board", () => {
  test("shows the rankings to a signed-out visitor", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    seedBoard(db, [{ user_id: RIVAL, display_name: "Layla", xp_this_week: 500 }]);

    await page.goto("/leaderboard");

    // Unguarded on purpose: the board is a reason to make an account, and the
    // view has already stripped everything that is not public.
    await expect(page.getByRole("heading", { name: "لوحة الصدارة" })).toBeVisible();
    await expect(page.getByText("Layla")).toBeVisible();
  });

  test("invites a signed-out visitor to join", async ({ page, signInAs, db }) => {
    await signInAs("anonymous");
    seedBoard(db, [{ user_id: RIVAL, display_name: "Layla", xp_this_week: 500 }]);

    await page.goto("/leaderboard");

    await expect(page.getByRole("button", { name: "سجّل الدخول للانضمام إلى لوحة الصدارة" })).toBeVisible();
    await expect(page.getByText("ترتيبك")).toHaveCount(0);
  });

  test("drops the invitation once signed in", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedBoard(db, [{ user_id: TEST_USER_ID, display_name: "Test Learner", xp_this_week: 60 }]);

    await page.goto("/leaderboard");
    await expect(page.getByText("Test Learner")).toBeVisible();

    await expect(page.getByRole("button", { name: "سجّل الدخول للانضمام إلى لوحة الصدارة" })).toHaveCount(0);
  });
});

test.describe("the weekly board", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("ranks by XP earned this week", async ({ page, db }) => {
    seedBoard(db, [
      { user_id: RIVAL, display_name: "Layla", xp_this_week: 120, total_xp: 100 },
      { user_id: THIRD, display_name: "Omar", xp_this_week: 900, total_xp: 50 },
    ]);

    await page.goto("/leaderboard");
    await expect(page.getByText("Omar")).toBeVisible();

    // Total XP is deliberately the inverse here: a weekly board that quietly
    // ranked by lifetime totals would never let a new learner get near the top,
    // which is the entire point of having a weekly board.
    const names = await page.locator("p.font-semibold.truncate").allTextContents();
    expect(names.map((n) => n.replace(" (you)", ""))).toEqual(["Omar", "Layla"]);
  });

  test("marks the learner's own row", async ({ page, db }) => {
    seedBoard(db, [
      { user_id: TEST_USER_ID, display_name: "Test Learner", xp_this_week: 60 },
      { user_id: RIVAL, display_name: "Layla", xp_this_week: 900 },
    ]);

    await page.goto("/leaderboard");

    await expect(page.getByText("(أنت)")).toBeVisible();
    await expect(page.getByText("Test Learner")).toBeVisible();
  });

  test("names nobody who opted out", async ({ page, db }) => {
    seedBoard(db, [{ user_id: RIVAL, display_name: "Layla", xp_this_week: 500 }]);
    // Someone with more XP than anyone on the board, absent from the view
    // because they turned the switch off.
    db.add("user_xp", aUserXp({ user_id: QUIET, xp_this_week: 99999, total_xp: 99999 }));
    db.add("profiles", aProfile({ user_id: QUIET, display_name: "Private", show_on_leaderboard: false }));

    await page.goto("/leaderboard");
    await expect(page.getByText("Layla")).toBeVisible();

    // The `.in(userIds)` filter is downstream of the view, so an opted-out
    // learner cannot appear even when their XP would put them first.
    await expect(page.getByText("Private")).toHaveCount(0);
    await expect(page.getByText("99,999")).toHaveCount(0);
  });

  test("calls an unnamed learner Anonymous", async ({ page, db }) => {
    seedBoard(db, [{ user_id: RIVAL, display_name: null, xp_this_week: 500 }]);

    await page.goto("/leaderboard");

    await expect(page.getByText("مجهول").first()).toBeVisible();
  });

  test("says so when nobody has earned anything", async ({ page, db }) => {
    seedBoard(db, []);

    await page.goto("/leaderboard");

    await expect(page.getByText("لا ترتيب بعد")).toBeVisible();
  });
});

test.describe("the all-time board", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedBoard(db, [
      { user_id: RIVAL, display_name: "Layla", xp_this_week: 900, total_xp: 100 },
      { user_id: THIRD, display_name: "Omar", xp_this_week: 10, total_xp: 8000 },
    ]);
  });

  test("re-ranks by lifetime XP", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.getByText("Layla")).toBeVisible();

    await page.getByRole("button", { name: "كل الأوقات" }).click();

    const names = await page.locator("p.font-semibold.truncate").allTextContents();
    expect(names).toEqual(["Omar", "Layla"]);
  });

  test("still labels every row with this week's XP", async ({ page }) => {
    await page.goto("/leaderboard");
    await page.getByRole("button", { name: "كل الأوقات" }).click();
    await expect(page.getByText("Omar")).toBeVisible();

    // A bug, pinned. `LeaderboardRow` renders `entry.xp_this_week` under the
    // fixed label "نقاط هذا الأسبوع" on both tabs, so the all-time board is sorted
    // by a number it never shows. Omar leads on 8,000 lifetime XP and is
    // displayed with 10 beside Layla's 900 — a board that reads as though the
    // sort is broken. The data is right and only the column is wrong, which is
    // why nobody would find this from the query.
    await expect(page.getByText("10", { exact: true })).toBeVisible();
    await expect(page.getByText("900")).toBeVisible();
    await expect(page.getByText("8,000")).toHaveCount(0);
    await expect(page.getByText("نقاط هذا الأسبوع").first()).toBeVisible();
  });

  test("goes back to the weekly ordering", async ({ page }) => {
    await page.goto("/leaderboard");
    await page.getByRole("button", { name: "كل الأوقات" }).click();
    await expect(page.getByText("Omar")).toBeVisible();

    await page.getByRole("button", { name: "هذا الأسبوع" }).click();

    const names = await page.locator("p.font-semibold.truncate").allTextContents();
    expect(names).toEqual(["Layla", "Omar"]);
  });
});

test.describe("the learner's own rank", () => {
  test("counts everyone above them this week", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedBoard(db, [
      { user_id: TEST_USER_ID, display_name: "Test Learner", xp_this_week: 60, total_xp: 250 },
      { user_id: RIVAL, display_name: "Layla", xp_this_week: 900, total_xp: 100 },
      { user_id: THIRD, display_name: "Omar", xp_this_week: 500, total_xp: 8000 },
    ]);

    await page.goto("/leaderboard");

    await expect(page.getByText("ترتيبك")).toBeVisible();
    await expect(page.getByText("#3")).toBeVisible();
  });

  test("re-ranks them when the tab changes", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedBoard(db, [
      { user_id: TEST_USER_ID, display_name: "Test Learner", xp_this_week: 60, total_xp: 250 },
      { user_id: RIVAL, display_name: "Layla", xp_this_week: 900, total_xp: 100 },
      { user_id: THIRD, display_name: "Omar", xp_this_week: 500, total_xp: 8000 },
    ]);

    await page.goto("/leaderboard");
    await expect(page.getByText("#3")).toBeVisible();

    await page.getByRole("button", { name: "كل الأوقات" }).click();

    // Third by the week, second by lifetime — the same learner, two honest
    // answers, which is why the card follows the tab.
    await expect(page.getByText("#2")).toBeVisible();
  });

  test("ranks them against people the board never shows", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedBoard(db, [
      { user_id: TEST_USER_ID, display_name: "Test Learner", xp_this_week: 60, total_xp: 250 },
    ]);
    db.add("user_xp", aUserXp({ user_id: QUIET, xp_this_week: 9999, total_xp: 9999 }));
    db.add("profiles", aProfile({ user_id: QUIET, display_name: "Private", show_on_leaderboard: false }));

    await page.goto("/leaderboard");
    await expect(page.getByText("Test Learner")).toBeVisible();

    // Worth knowing about rather than obviously wrong. `useMyRank` counts rows
    // in `user_xp` directly, without the view, so opted-out learners still
    // count towards the number. The learner is the only name on a one-row board
    // and is told they are #2 — arguably the truthful rank, but not one the
    // page gives them any way to reconcile.
    await expect(page.getByText("#2")).toBeVisible();
  });
});

test.describe("institutions", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows a verified institution beside the name", async ({ page, db }) => {
    seedBoard(db, [
      {
        user_id: RIVAL,
        display_name: "Layla",
        xp_this_week: 500,
        institution_id: anInstitution().id,
      },
    ]);
    db.seed("institutions", [anInstitution()]);

    await page.goto("/leaderboard");

    await expect(page.getByText("Qatar University")).toBeVisible();
  });

  test("shows a self-typed institution too", async ({ page, db }) => {
    seedBoard(db, [
      {
        user_id: RIVAL,
        display_name: "Layla",
        xp_this_week: 500,
        custom_institution: "Evening class",
      },
    ]);

    // Unverified and unlisted, so it gets no check mark — but a learner who
    // typed their own school should still see it.
    await page.goto("/leaderboard");

    await expect(page.getByText("Evening class")).toBeVisible();
    await expect(page.locator("svg.lucide-badge-check")).toHaveCount(0);
  });

  test("respects a learner who hid their institution", async ({ page, db }) => {
    seedBoard(db, [
      {
        user_id: RIVAL,
        display_name: "Layla",
        xp_this_week: 500,
        institution_id: anInstitution().id,
        show_institution: false,
      },
    ]);
    db.seed("institutions", [anInstitution()]);

    await page.goto("/leaderboard");
    await expect(page.getByText("Layla")).toBeVisible();

    // A second opt-out, independent of the leaderboard one: appear on the
    // board without saying where you study.
    await expect(page.getByText("Qatar University")).toHaveCount(0);
  });
});

test.describe("editing the public profile", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedBoard(db, [
      { user_id: TEST_USER_ID, display_name: "Test Learner", xp_this_week: 60 },
    ]);
    db.seed("institutions", [anInstitution()]);
  });

  test("saves a new display name", async ({ page, db }) => {
    await page.goto("/leaderboard");
    await expect(page.getByText("Test Learner")).toBeVisible();

    await page.locator("button:has(svg.lucide-settings)").click();
    await page.getByLabel("الاسم الظاهر").fill("Layla al-Kuwaiti");
    await page.getByRole("button", { name: /احفظ/ }).click();

    await expect
      .poll(() => db.rows("profiles").find((r) => r.user_id === TEST_USER_ID)?.display_name)
      .toBe("Layla al-Kuwaiti");
  });

  test("lets a learner take themselves off the board", async ({ page, db }) => {
    await page.goto("/leaderboard");
    await expect(page.getByText("Test Learner")).toBeVisible();

    await page.locator("button:has(svg.lucide-settings)").click();
    await page.getByRole("switch", { name: /لوحة الصدارة/ }).click();
    await page.getByRole("button", { name: /احفظ/ }).click();

    // The switch behind the whole privacy story above. It has to reach the
    // column the view filters on, or the opt-out is decorative.
    await expect
      .poll(() => db.rows("profiles").find((r) => r.user_id === TEST_USER_ID)?.show_on_leaderboard)
      .toBe(false);
  });

  test("catches up with the profile when the dialog opens before it loads", async ({
    page,
    db,
  }) => {
    db.seed("profiles", [
      aProfile({
        display_name: "Layla al-Kuwaiti",
        show_on_leaderboard: false,
        custom_institution: "Evening class",
      }),
    ]);
    db.delay("profiles", 2500);

    await page.goto("/leaderboard");
    await page.locator("button:has(svg.lucide-settings)").click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Seeding used to happen inline in `handleOpen`, guarded by
    // `if (isOpen && profile)` with no else and nothing to catch up — so a
    // dialog opened before the query resolved showed the useState defaults,
    // and Save wrote them. The learner lost their display name and was put
    // back on a leaderboard they had deliberately left, having touched
    // neither control. Save is now held until there is something to save.
    await expect(page.getByRole("button", { name: /احفظ/ })).toBeDisabled();

    await expect(page.getByLabel("الاسم الظاهر")).toHaveValue("Layla al-Kuwaiti");
    await expect(page.getByRole("switch", { name: /لوحة الصدارة/ })).not.toBeChecked();

    await page.getByRole("button", { name: /احفظ/ }).click();

    // Saving without touching a control leaves the profile as it was.
    await expect
      .poll(() => db.rows("profiles").find((r) => r.user_id === TEST_USER_ID))
      .toMatchObject({
        display_name: "Layla al-Kuwaiti",
        show_on_leaderboard: false,
        custom_institution: "Evening class",
      });
  });

  test("stores a self-typed institution rather than an id", async ({ page, db }) => {
    await page.goto("/leaderboard");
    await expect(page.getByText("Test Learner")).toBeVisible();

    await page.locator("button:has(svg.lucide-settings)").click();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /Other/ }).click();
    await page.getByLabel("اسم المؤسسة").fill("Evening class");
    await page.getByRole("button", { name: /احفظ/ }).click();

    await expect
      .poll(() => db.rows("profiles").find((r) => r.user_id === TEST_USER_ID))
      .toMatchObject({ custom_institution: "Evening class", institution_id: null });
  });
});
