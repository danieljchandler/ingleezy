import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, videoId as makeVideoId } from "../src/test/support/factories";

/**
 * The Hakiya bridge, from the admin side.
 *
 * `sync-hakiya-videos` copies the sibling Arabic app's published clips into
 * the same `discover_videos` table the local pipeline writes to, tagged
 * `source: 'hakiya'`. For Ingleezy's learners those are secondary immersion
 * content — Arabic speech whose transcript already carries natural English —
 * so they need no separate surface. What they do need is a way in, and a way
 * to tell them apart once they arrive.
 *
 * Two things are worth pinning here and nowhere else. The button must report
 * what the sync actually did rather than a bare "done": a bridge that has
 * quietly stopped copying anything, or that is skipping every drifted remote
 * row, looks identical to a healthy one unless the counts are on screen. And
 * an unconfigured bridge — the normal state until the Hakiya env vars are set
 * — has to say so in those words, because "sync failed" would send an admin
 * looking for a bug that isn't there.
 */

const syncButton = "Sync from Hakiya";

test.describe("syncing from Hakiya", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("discover_videos", []);
  });

  test("reports how many landed", async ({ page, backend }) => {
    backend.stubFunction("sync-hakiya-videos", { success: true, synced: 12, skipped: 0, fetched: 12 });

    await page.goto("/admin/videos");
    await page.getByRole("button", { name: syncButton }).click();

    await expect(page.getByText("Synced 12 videos from Hakiya")).toBeVisible();
  });

  test("names the skipped rows rather than counting them as synced", async ({ page, backend }) => {
    // A remote row with no id or no embed_url is dropped on purpose — the
    // upsert could not stay idempotent without an id, and the player has
    // nothing to show without an embed. Folding those into the success count
    // would turn Hakiya schema drift into a silent content gap.
    backend.stubFunction("sync-hakiya-videos", { success: true, synced: 8, skipped: 3, fetched: 11 });

    await page.goto("/admin/videos");
    await page.getByRole("button", { name: syncButton }).click();

    await expect(page.getByText("Synced 8 videos from Hakiya")).toBeVisible();
    await expect(page.getByText(/3 skipped/)).toBeVisible();
  });

  test("says an unconfigured bridge is unconfigured", async ({ page, backend }) => {
    backend.stubFunctionFailure("sync-hakiya-videos", 503, {
      error: "bridge_not_configured",
      detail: "HAKIYA_SUPABASE_URL / HAKIYA_SUPABASE_ANON_KEY missing",
    });

    await page.goto("/admin/videos");
    await page.getByRole("button", { name: syncButton }).click();

    await expect(page.getByText(/not configured/i)).toBeVisible();
  });

  test("marks a bridged row so it is not mistaken for one of ours", async ({ page, db }) => {
    // Editing a bridged row is pointless — the next sync overwrites it from
    // Hakiya — so the list has to say which rows those are.
    db.seed("discover_videos", [
      aDiscoverVideo({ id: makeVideoId(0), title: "Coffee shop chat", source: "hakiya" }),
      aDiscoverVideo({ id: makeVideoId(1), title: "Our own clip" }),
    ]);

    await page.goto("/admin/videos");

    await expect(page.getByRole("heading", { name: "Coffee shop chat" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Our own clip" })).toBeVisible();
    // Exactly one badge: on the bridged row, and not on ours.
    await expect(page.getByText("Hakiya", { exact: true })).toHaveCount(1);
  });
});
