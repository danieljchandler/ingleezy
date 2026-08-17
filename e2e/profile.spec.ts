import { expect, test } from "./support/fixtures";
import { aProfile, aUserVocabulary, aUserXp, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The profile passport, and the Me hub that points at it.
 *
 * Profile is entirely derived — it stores nothing and writes nothing. Every
 * number on it is computed from rows that live somewhere else: XP and level
 * from `user_xp`, streaks from `review_streaks`, badges from
 * `user_achievements`, and the "dialect stamps" by bucketing the learner's
 * saved vocabulary. That makes the aggregation the whole surface, and it is the
 * part no other test touches — the same rows are read by other pages, but only
 * here are they counted.
 *
 * The Me hub is the opposite: no data at all, just a grid whose tiles appear or
 * disappear per role. Which is exactly the kind of thing that rots silently, so
 * the tests here are about *absence* as much as presence.
 */

function seedProfile(db: MemoryDb, over: Record<string, unknown> = {}) {
  db.seed("profiles", [aProfile({ created_at: "2024-03-15T00:00:00Z", ...over })]);
  db.seed("user_xp", [aUserXp({ total_xp: 0 })]);
  db.seed("user_vocabulary", []);
  db.seed("review_streaks", []);
  db.seed("user_achievements", []);
  db.seed("achievements", []);
}

/** A saved word in a given dialect. `interval_days >= 7` counts as mature. */
const aWord = (id: string, dialect: string | null, intervalDays: number) =>
  aUserVocabulary({
    id,
    user_id: TEST_USER_ID,
    word_arabic: `كلمة-${id}`,
    dialect,
    interval_days: intervalDays,
  });

test.describe("getting in", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/profile");

    await expect(page).toHaveURL(/\/auth/);
  });
});

test.describe("the passport", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedProfile(db);
  });

  test("shows the display name", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ display_name: "Layla", created_at: "2024-03-15T00:00:00Z" })]);

    await page.goto("/profile");

    await expect(page.getByRole("heading", { name: "Layla" })).toBeVisible();
  });

  test("calls an unnamed learner Traveler", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ display_name: null, created_at: "2024-03-15T00:00:00Z" })]);

    await page.goto("/profile");

    // The name is optional at signup, so the fallback is the common case for a
    // new account rather than an edge case.
    await expect(page.getByRole("heading", { name: "مسافر" })).toBeVisible();
  });

  test("shows when the account was opened", async ({ page }) => {
    await page.goto("/profile");

    await expect(page.getByText(/عضو منذ مارس 2024/)).toBeVisible();
  });

  test("shows an em dash rather than an invalid date", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ created_at: null })]);

    await page.goto("/profile");

    // A null `created_at` through `new Date()` renders "Invalid Date", which is
    // how this class of bug shows up elsewhere in the app.
    await expect(page.getByText("عضو منذ —")).toBeVisible();
  });

  test("derives the level from total XP", async ({ page, db }) => {
    db.seed("user_xp", [aUserXp({ total_xp: 450 })]);

    await page.goto("/profile");

    // The level is computed, not stored — nothing writes a level column, so a
    // change to the curve moves every learner at once.
    await expect(page.getByText(/^LV \d+$/)).toBeVisible();
    await expect(page.getByText(/XP$/)).toBeVisible();
  });

  test("shows level 1 for a learner with no XP row at all", async ({ page, db }) => {
    db.seed("user_xp", []);

    await page.goto("/profile");

    // A learner who has never earned XP has no row, not a zero row.
    await expect(page.getByText("LV 1")).toBeVisible();
  });

  test("falls back to an initial when there is no avatar", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ display_name: "Layla", avatar_url: null })]);

    await page.goto("/profile");

    await expect(page.getByText("L", { exact: true })).toBeVisible();
  });
});

test.describe("the headline stats", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedProfile(db);
  });

  test("counts saved words and how many are mature", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aWord("a", "Gulf", 30),
      aWord("b", "Gulf", 7),
      aWord("c", "Gulf", 3),
      aWord("d", "Gulf", 0),
    ]);

    await page.goto("/profile");

    // Mature is `interval_days >= 7` — the boundary is inclusive, so the
    // seven-day word counts.
    await expect(page.getByText("الكلمات")).toBeVisible();
    await expect(page.getByText("4", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("2 متقنة")).toBeVisible();
  });

  test("shows the current streak and the best one", async ({ page, db }) => {
    db.seed("review_streaks", [
      { user_id: TEST_USER_ID, current_streak: 4, longest_streak: 21 },
    ]);

    await page.goto("/profile");

    await expect(page.getByText("السلسلة")).toBeVisible();
    await expect(page.getByText("الأفضل 21")).toBeVisible();
  });

  test("shows zeros rather than blanks for a learner with no streak row", async ({
    page,
    db,
  }) => {
    db.seed("review_streaks", []);

    await page.goto("/profile");

    await expect(page.getByText("الأفضل 0")).toBeVisible();
  });
});

test.describe("dialect stamps", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedProfile(db);
  });

  test("earns one stamp per dialect studied", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aWord("a", "Gulf", 10),
      aWord("b", "Egyptian", 2),
      aWord("c", "Yemeni", 0),
    ]);

    await page.goto("/profile");

    await expect(page.getByText("3 طوابع")).toBeVisible();
    await expect(page.getByText("خليجي")).toBeVisible();
    await expect(page.getByText("مصري")).toBeVisible();
    await expect(page.getByText("يمني")).toBeVisible();
  });

  test("says stamp rather than stamps for a single dialect", async ({ page, db }) => {
    db.seed("user_vocabulary", [aWord("a", "Gulf", 10)]);

    await page.goto("/profile");

    await expect(page.getByText("طابع واحد", { exact: true })).toBeVisible();
  });

  test("orders the stamps by how much was studied", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aWord("a", "Egyptian", 1),
      aWord("b", "Gulf", 1),
      aWord("c", "Gulf", 1),
      aWord("d", "Gulf", 1),
    ]);

    await page.goto("/profile");

    // Most-studied first, so the dialect the learner actually works in leads
    // rather than whichever word happened to be saved first. Read via the
    // Arabic label, which appears exactly once per stamp.
    await expect(page.getByText("خليجي")).toBeVisible();
    const stamps = await page.getByText(/^(خليجي|مصري|يمني)$/).allTextContents();
    expect(stamps).toEqual(["خليجي", "مصري"]);
  });

  test("shows mature over total per dialect", async ({ page, db }) => {
    db.seed("user_vocabulary", [
      aWord("a", "Gulf", 30),
      aWord("b", "Gulf", 1),
      aWord("c", "Gulf", 1),
    ]);

    await page.goto("/profile");

    await expect(page.getByText("1/3")).toBeVisible();
  });

  test("files a word with no dialect under Gulf", async ({ page, db }) => {
    db.seed("user_vocabulary", [aWord("a", null, 1)]);

    await page.goto("/profile");

    // `dialect` is nullable on `user_vocabulary`, and words saved before the
    // column existed have none. Without the default they would bucket under
    // "null" and render a stamp with no name.
    await expect(page.getByText("خليجي", { exact: true })).toBeVisible();
    await expect(page.getByText("طابع واحد", { exact: true })).toBeVisible();
  });

  test("keeps a stamp for a dialect the app no longer offers", async ({ page, db }) => {
    db.seed("user_vocabulary", [aWord("a", "Levantine", 1)]);

    await page.goto("/profile");

    // No metadata entry, so it falls back to using the dialect name for both
    // the label and the Arabic. A learner's history is not deleted because the
    // app's dialect list changed.
    await expect(page.getByText("Levantine").first()).toBeVisible();
  });

  test("points an empty passport at saving a word", async ({ page }) => {
    await page.goto("/profile");

    await expect(page.getByText("لا طوابع بعد")).toBeVisible();
    await expect(page.getByText(/احفظ كلمة لتكسب أول طابع/)).toBeVisible();
  });
});

test.describe("badges", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedProfile(db);
  });

  test("points an empty case at the daily challenge", async ({ page }) => {
    await page.goto("/profile");

    await expect(page.getByText(/اكسب أول وسام/)).toBeVisible();
  });

  test("shows earned badges with their icons", async ({ page, db }) => {
    db.seed("achievements", [
      { id: "ach-1", name: "First Word", icon: "🌱", description: "Save a word" },
    ]);
    db.seed("user_achievements", [
      {
        id: "ua-1",
        user_id: TEST_USER_ID,
        achievement_id: "ach-1",
        earned_at: new Date().toISOString(),
      },
    ]);

    await page.goto("/profile");

    await expect(page.getByText("First Word")).toBeVisible();
    await expect(page.getByText("🌱")).toBeVisible();
  });

  test("shows at most six and offers the rest elsewhere", async ({ page, db }) => {
    db.seed(
      "achievements",
      Array.from({ length: 8 }, (_, i) => ({
        id: `ach-${i}`,
        name: `Badge ${i}`,
        icon: "🏅",
        description: "",
      })),
    );
    // Stamped a minute apart, newest first, because the grid is ordered by
    // earned_at. Seeding these with new Date() gives eight equal timestamps
    // when the loop stays inside one millisecond and eight ascending ones when
    // it does not — so which six survived the slice came down to how fast the
    // machine happened to be that run. That is a flake, not a test.
    db.seed(
      "user_achievements",
      Array.from({ length: 8 }, (_, i) => ({
        id: `ua-${i}`,
        user_id: TEST_USER_ID,
        achievement_id: `ach-${i}`,
        earned_at: new Date(Date.UTC(2025, 0, 1, 12, 8 - i)).toISOString(),
      })),
    );

    await page.goto("/profile");
    await expect(page.getByText("Badge 0")).toBeVisible();

    // Six is the grid; the overflow link only appears when there is overflow.
    await expect(page.getByText(/^Badge \d$/)).toHaveCount(6);
    await expect(page.getByRole("button", { name: "عرض الكل" })).toBeVisible();
  });

  test("offers no view-all link for six or fewer", async ({ page, db }) => {
    db.seed("achievements", [
      { id: "ach-1", name: "Only Badge", icon: "🏅", description: "" },
    ]);
    db.seed("user_achievements", [
      { id: "ua-1", user_id: TEST_USER_ID, achievement_id: "ach-1", earned_at: new Date().toISOString() },
    ]);

    await page.goto("/profile");
    await expect(page.getByText("Only Badge")).toBeVisible();

    await expect(page.getByRole("button", { name: "عرض الكل" })).toHaveCount(0);
  });
});

test.describe("when the profile will not load", () => {
  test("shows an empty passport instead of saying anything went wrong", async ({
    page,
    signInAs,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await signInAs("free");
    seedProfile(db, { display_name: "Layla" });
    db.failAlways("profiles", 500);
    db.failAlways("user_vocabulary", 500);
    db.failAlways("review_streaks", 500);

    await page.goto("/profile");

    // Pinned, not endorsed. The load is wrapped in a try/catch that sets an
    // error banner and offers a retry — but a PostgREST failure resolves as
    // `{ data: null, error }` rather than throwing, so nothing is caught and
    // neither the banner nor the "Try again" button can ever appear. The
    // learner sees a fully-rendered passport belonging to "Traveler" with zero
    // words, zero streak and no stamps, which is indistinguishable from a
    // brand-new account.
    await expect(page.getByRole("heading", { name: "مسافر" })).toBeVisible();
    await expect(page.getByText("لا طوابع بعد")).toBeVisible();
    await expect(page.getByText(/تعذّر تحميل بيانات الملف الشخصي/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "أعد المحاولة" })).toHaveCount(0);
  });
});

test.describe("the Me hub", () => {
  test("offers the library only to a signed-in learner", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedProfile(db);

    await page.goto("/me");

    for (const tile of ["كلماتي", "ترجمات محفوظة", "نصوصي المفرّغة", "فيديوهات أعجبتني"]) {
      await expect(page.getByRole("button", { name: new RegExp(tile) })).toBeVisible();
    }
  });

  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/me");

    // Guarded at the route, so the per-tile `show: isAuthenticated` flags on
    // My Words, Liked Videos, Analytics, Profile and Friends are belt and
    // braces — the hub is never reached signed out. Worth knowing: those flags
    // are the only thing that would matter if the route guard were ever
    // loosened, and nothing else asserts them.
    await expect(page).toHaveURL(/\/auth/);
  });

  test("shows the admin console only to an admin", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedProfile(db);
    await page.goto("/me");
    await expect(page.getByRole("button", { name: /الإدارة/ })).toHaveCount(0);

    await signInAs("admin");
    seedProfile(db);
    await page.goto("/me");

    await expect(page.getByRole("button", { name: /الإدارة/ })).toBeVisible();
  });
});
