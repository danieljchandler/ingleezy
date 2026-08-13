import { expect, test } from "./support/fixtures";
import { aDiscoverVideo, daysAgo, iso, many, videoId } from "../src/test/support/factories";

/**
 * `/admin/memes` — the meme shelf.
 *
 * There is no meme table: a meme is a `discover_videos` row with `is_meme`
 * true, and every editing control hands off to the video form with `?meme=1`.
 * So the interesting behaviour here is the filtering (a meme list that leaked
 * ordinary Discover clips, or a Gulf list showing Egyptian ones, is the failure
 * this page can actually have) and the handoff, not a CRUD form of its own.
 *
 * The list loads through `useEffect` rather than TanStack Query, so nothing
 * retries and nothing refetches on focus — a failed load has to be visible in
 * the page or it is invisible altogether.
 */

const aMeme = (over: Record<string, unknown> = {}) =>
  aDiscoverVideo({ is_meme: true, platform: "tiktok", ...over });

test.describe("the meme shelf", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("says when the shelf is empty", async ({ page, db }) => {
    db.seed("discover_videos", []);
    await page.goto("/admin/memes");

    await expect(page.getByText(/no memes yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /new meme/i })).toBeVisible();
  });

  test("shows a meme with its title, platform and state", async ({ page, db }) => {
    db.seed("discover_videos", [
      aMeme({
        title: "Cat argues back",
        title_arabic: "قطة ترد",
        platform: "tiktok",
        published: true,
      }),
    ]);

    await page.goto("/admin/memes");

    await expect(page.getByText("Cat argues back")).toBeVisible();
    await expect(page.getByText("قطة ترد")).toBeVisible();
    await expect(page.getByText("tiktok", { exact: true })).toBeVisible();
    await expect(page.getByText("published", { exact: true })).toBeVisible();
  });

  test("marks an unpublished meme as a draft", async ({ page, db }) => {
    db.seed("discover_videos", [aMeme({ title: "Cat argues back", published: false })]);
    await page.goto("/admin/memes");

    await expect(page.getByText("draft", { exact: true })).toBeVisible();
    // Nothing to view yet — the public route would 404 on an unpublished clip.
    await expect(page.getByRole("button", { name: /view/i })).toHaveCount(0);
  });

  test("surfaces a transcription still in flight", async ({ page, db }) => {
    db.seed("discover_videos", [
      aMeme({ title: "Cat argues back", transcription_status: "processing" }),
    ]);
    await page.goto("/admin/memes");

    await expect(page.getByText("processing")).toBeVisible();
  });

  test("says nothing about a transcription that finished", async ({ page, db }) => {
    db.seed("discover_videos", [
      aMeme({ title: "Cat argues back", transcription_status: "completed" }),
    ]);
    await page.goto("/admin/memes");

    await expect(page.getByText("completed")).toHaveCount(0);
  });

  test("falls back to a placeholder title", async ({ page, db }) => {
    db.seed("discover_videos", [aMeme({ title: "" })]);
    await page.goto("/admin/memes");

    await expect(page.getByText("Untitled meme")).toBeVisible();
  });

  test("leaves ordinary Discover clips off the shelf", async ({ page, db }) => {
    db.seed("discover_videos", [
      aMeme({ id: videoId(0), title: "A meme" }),
      aDiscoverVideo({ id: videoId(1), title: "A lesson clip", is_meme: false }),
    ]);

    await page.goto("/admin/memes");

    await expect(page.getByText("A meme")).toBeVisible();
    await expect(page.getByText("A lesson clip")).toHaveCount(0);
  });

  test("shows only the active dialect's memes", async ({ page, db }) => {
    db.seed("discover_videos", [
      aMeme({ id: videoId(0), title: "Gulf meme", dialect: "Gulf" }),
      aMeme({ id: videoId(1), title: "Cairo meme", dialect: "Egyptian" }),
    ]);

    await page.goto("/admin/memes");

    await expect(page.getByText("Gulf meme")).toBeVisible();
    await expect(page.getByText("Cairo meme")).toHaveCount(0);
  });

  test("reloads when the dialect changes", async ({ page, db }) => {
    db.seed("discover_videos", [
      aMeme({ id: videoId(0), title: "Gulf meme", dialect: "Gulf" }),
      aMeme({ id: videoId(1), title: "Cairo meme", dialect: "Egyptian" }),
    ]);

    await page.goto("/admin/memes");
    await expect(page.getByText("Gulf meme")).toBeVisible();

    await page.getByRole("button", { name: /Egyptian Arabic/ }).click();

    await expect(page.getByText("Cairo meme")).toBeVisible();
    await expect(page.getByText("Gulf meme")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Memes \(Egyptian\)/ })).toBeVisible();
  });

  test("puts the newest meme first", async ({ page, db }) => {
    db.seed(
      "discover_videos",
      many(aMeme, 3, (index) => ({
        id: videoId(index),
        title: `meme ${index}`,
        created_at: iso(-index * 60_000),
      })),
    );

    await page.goto("/admin/memes");

    const titles = page.locator("div.font-medium.text-sm");
    await expect(titles).toHaveCount(3);
    await expect(titles.first()).toHaveText("meme 0");
    await expect(titles.last()).toHaveText("meme 2");
  });

  test("reports a failed load rather than showing an empty shelf", async ({ page, db }) => {
    db.seed("discover_videos", [aMeme({ title: "Cat argues back" })]);
    db.failAlways("discover_videos", 500);

    await page.goto("/admin/memes");

    await expect(page.getByText(/failed to load memes/i)).toBeVisible();
    // The empty state still shows underneath, because `load` writes `[]` on the
    // error path too — the toast is the only thing distinguishing "no memes"
    // from "could not read them".
    await expect(page.getByText(/no memes yet/i)).toBeVisible();
  });
});

test.describe("editing a meme", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("discover_videos", [aMeme({ id: videoId(0), title: "Cat argues back" })]);
  });

  test("creating one opens the video form in meme mode", async ({ page }) => {
    await page.goto("/admin/memes");

    await page.getByRole("button", { name: /new meme/i }).click();

    await expect(page).toHaveURL(/\/admin\/videos\/new\?meme=1$/);
  });

  test("the edit button opens that meme in the video form", async ({ page }) => {
    await page.goto("/admin/memes");

    await page.getByRole("button", { name: /^edit$/i }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/videos/${videoId(0)}/edit\\?meme=1$`));
  });

  test("the thumbnail is a second way into the same form", async ({ page }) => {
    await page.goto("/admin/memes");

    await page.locator("div.aspect-video").click();

    await expect(page).toHaveURL(new RegExp(`/admin/videos/${videoId(0)}/edit\\?meme=1$`));
  });

  test("a published meme links out to how a learner sees it", async ({ page, db }) => {
    db.seed("discover_videos", [aMeme({ id: videoId(0), title: "Cat", published: true })]);
    await page.goto("/admin/memes");

    await page.getByRole("button", { name: /view/i }).click();

    await expect(page).toHaveURL(new RegExp(`/discover/${videoId(0)}$`));
  });

  test("/admin/memes/new redirects into the video form", async ({ page }) => {
    // AdminMemeForm is a redirect shim; both its routes exist only so a linked
    // or bookmarked meme URL still lands somewhere sensible.
    await page.goto("/admin/memes/new");

    await expect(page).toHaveURL(/\/admin\/videos\/new\?meme=1$/);
  });

  test("/admin/memes/:id redirects to that meme's video form", async ({ page }) => {
    await page.goto(`/admin/memes/${videoId(0)}`);

    await expect(page).toHaveURL(new RegExp(`/admin/videos/${videoId(0)}/edit\\?meme=1$`));
  });
});

test.describe("deleting a meme", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("discover_videos", [aMeme({ id: videoId(0), title: "Cat argues back" })]);
  });

  test("asks first, through the browser's own confirm", async ({ page, db }) => {
    // A native `confirm()`, not the AlertDialog the rest of the admin uses — so
    // it cannot be styled, cannot say what else is deleted, and is dismissed by
    // Playwright's default dialog handling unless a handler is installed.
    page.on("dialog", (dialog) => dialog.dismiss());
    await page.goto("/admin/memes");

    await page.locator("button.absolute.top-2.right-2").click();

    await expect(page.getByText("Cat argues back")).toBeVisible();
    expect(db.writesTo("discover_videos")).toHaveLength(0);
  });

  test("deletes once confirmed", async ({ page, db }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/memes");

    await page.locator("button.absolute.top-2.right-2").click();

    await expect(page.getByText(/^Deleted$/)).toBeVisible();
    expect(db.rows("discover_videos")).toHaveLength(0);
    await expect(page.getByText(/no memes yet/i)).toBeVisible();
  });

  test("deleting does not open the edit form as well", async ({ page }) => {
    // The delete control sits inside the thumbnail's click target, so it has to
    // stop propagation or every delete navigates away mid-request.
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/memes");

    await page.locator("button.absolute.top-2.right-2").click();

    await expect(page).toHaveURL(/\/admin\/memes$/);
  });

  test("reports a rejected delete instead of pretending it worked", async ({ page, db }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/memes");

    db.failWrites("discover_videos", 403);
    await page.locator("button.absolute.top-2.right-2").click();

    await expect(page.getByText(/^Deleted$/)).toHaveCount(0);
    expect(db.rows("discover_videos")).toHaveLength(1);
    await expect(page.getByText("Cat argues back")).toBeVisible();
  });
});

test.describe("who can open it", () => {
  test("a recorder may manage memes", async ({ page, signInAs, db }) => {
    await signInAs("recorder");
    db.seed("discover_videos", [aMeme({ title: "Cat argues back" })]);

    await page.goto("/admin/memes");

    await expect(page.getByRole("heading", { name: /Memes \(Gulf\)/ })).toBeVisible();
    await expect(page.getByText("Cat argues back")).toBeVisible();
  });

  test("a content reviewer is turned away", async ({ page, signInAs, db }) => {
    // rbac.ts allow-lists /admin/videos for a reviewer but not /admin/memes,
    // even though every control on this page leads straight to /admin/videos.
    await signInAs("content_reviewer");
    db.seed("discover_videos", [aMeme({ title: "Cat argues back" })]);

    await page.goto("/admin/memes");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(/access denied/i)).toBeVisible();
  });

  test("a signed-in learner is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/admin/memes");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("a signed-out visitor is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/admin/memes");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

test.describe("what the shelf leaves out", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("offers no way to publish a meme from the list", async ({ page, db }) => {
    // Pinned, not fixed. The badge shows draft or published but nothing here
    // toggles it: publishing means opening the video form. On a shelf whose
    // stated job is review-and-ship, that is a round trip per meme.
    db.seed("discover_videos", [aMeme({ title: "Cat argues back", published: false })]);
    await page.goto("/admin/memes");

    await expect(page.getByText("draft", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /publish/i })).toHaveCount(0);
  });

  test("shows a stalled transcription with no way to retry it", async ({ page, db }) => {
    // Pinned, not fixed. `transcription_status: "failed"` renders as a plain
    // badge — the same treatment as "processing" — with no retry control and
    // nothing to say the clip will never finish on its own.
    db.seed("discover_videos", [
      aMeme({ title: "Cat argues back", transcription_status: "failed" }),
    ]);
    await page.goto("/admin/memes");

    await expect(page.getByText("failed")).toBeVisible();
    await expect(page.getByRole("button", { name: /retry/i })).toHaveCount(0);
  });

  test("keeps an old meme on the shelf with no age of its own", async ({ page, db }) => {
    // `created_at` orders the shelf but is never shown, so a meme that has sat
    // in draft for a month looks exactly like one added this morning.
    db.seed("discover_videos", [
      aMeme({ title: "Cat argues back", created_at: daysAgo(90), published: false }),
    ]);
    await page.goto("/admin/memes");

    await expect(page.getByText("Cat argues back")).toBeVisible();
    await expect(page.getByText(/ago/i)).toHaveCount(0);
  });
});
