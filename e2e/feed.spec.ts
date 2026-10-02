import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, videoId } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * The clips feed: a vertical feed of real English clips.
 *
 * It was the front door for a while; Today took that job back, and the feed
 * moved to /feed as the first shelf of the library. What these tests hold in
 * place is that the feed stays a feed: content first, the tools applied to that
 * content rather than listed somewhere else, and — the failure mode that would
 * actually sink this format — an empty state that still gives the learner
 * somewhere to go.
 */

function seedFeed(db: MemoryDb, backend: SupabaseBackend, count = 2) {
  const videos = Array.from({ length: count }, (_, i) =>
    aDiscoverVideo({
      id: videoId(i),
      title: i === 0 ? "I'm not gonna lie — that was rough." : `Clip ${i}`,
      title_arabic: i === 0 ? "ما راح أكذب عليك — كانت صعبة." : null,
      duration_seconds: 192,
    }),
  );
  db.seed("discover_videos", videos);
  backend.stubFunction("discover-feed", {
    items: videos.map((v) => ({
      video_id: v.id,
      score: 1,
      comprehension: 0.8,
      reason: "match",
      bucket: "match",
    })),
    cold_start: false,
    seed: 1,
    active_dialect: "Gulf",
    cefr: null,
  });
}

test.describe("the feed", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("opens on the English, with the dialect underneath", async ({ page, db, backend }) => {
    seedFeed(db, backend);

    await page.goto("/feed");

    // The English is the material. The Arabic rides along as help, the same
    // contract every other surface in the app uses.
    await expect(page.getByText("I'm not gonna lie — that was rough.")).toBeVisible();
    await expect(page.getByText("ما راح أكذب عليك — كانت صعبة.")).toBeVisible();
  });

  test("puts the tools on the clip rather than in a menu", async ({ page, db, backend }) => {
    seedFeed(db, backend, 1);

    await page.goto("/feed");

    // This rail is the whole reason three hub screens could go away: "ask" and
    // "transcript" stopped being destinations you navigate to and then have to
    // feed with content, and became buttons on the content itself.
    await expect(page.getByRole("link", { name: "اسأل" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "النص" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "احفظ" }).first()).toBeVisible();
  });

  test("offers a way out when there is nothing to watch", async ({ page }) => {
    await page.goto("/feed");

    // The real risk of betting the home screen on a feed: a video app with no
    // videos is worse than a list. An empty feed must still hand over the two
    // things that work with no library behind them.
    await expect(page.getByText("ما فيه مقاطع جديدة الحين")).toBeVisible();
    await expect(page.getByRole("link", { name: "ارفع مقطعاً" })).toBeVisible();
    await expect(page.getByRole("link", { name: "اختر مهارة" })).toBeVisible();
  });

  test("reaches the profile from the emblem, not a nav tab", async ({ page, db, backend }) => {
    seedFeed(db, backend, 1);

    await page.goto("/feed");
    await page.getByRole("link", { name: /حسابك/ }).click();

    // The emblem sits top-start on every surface and never moves, which is what
    // makes it reachable without looking — a tab competes with four neighbours.
    await expect(page).toHaveURL(/\/me$/);
  });
});

test.describe("the dock", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("carries four tabs, and profile is not one of them", async ({ page }) => {
    await page.goto("/feed");

    const dock = page.getByRole("navigation", { name: "التنقل الرئيسي" });
    // اليوم · المكتبة · تكلّم · كلماتي. Profile lives in the emblem, which
    // never moves.
    await expect(dock.getByRole("link")).toHaveCount(4);
    await expect(dock.getByRole("link", { name: "أنا" })).toHaveCount(0);
  });

  test("lights the library, which the feed belongs to", async ({ page }) => {
    await page.goto("/feed");

    await expect(
      page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("link", { name: "المكتبة" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("goes back to the library from the dock", async ({ page }) => {
    await page.goto("/feed");
    await page.getByRole("navigation", { name: "التنقل الرئيسي" })
      .getByRole("link", { name: "المكتبة" }).click();

    await expect(page).toHaveURL(/\/library$/);
  });
});
