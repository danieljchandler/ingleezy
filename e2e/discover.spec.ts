import { expect, test, type Page } from "./support/fixtures";
import { aDiscoverVideo, aProfile, videoId, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * Discover — the video library and the personalised feed.
 *
 * Two independent surfaces behind one page. Browse is a plain filtered query,
 * and every filter it applies is a `.eq`/`.in`/`.ilike` the backend has to
 * honour for the result to mean anything — a filter that silently does nothing
 * shows a learner the whole catalogue and looks like it worked. The For You tab
 * is an edge function that returns ranked ids, which the page then hydrates from
 * the table; an id the hydration cannot resolve has to be dropped rather than
 * rendered as a blank card.
 *
 * Feed items are hidden behind a tab that is only enabled when signed in, and
 * Browse defaults its difficulty filter from the learner's placement level —
 * both of which decide what the page shows before the learner touches anything.
 */

/** `count` published videos, all Gulf/Beginner unless overridden. */
function seedVideos(
  db: MemoryDb,
  rows: Array<Record<string, unknown>>,
) {
  db.seed(
    "discover_videos",
    rows.map((row, index) => aDiscoverVideo({ id: videoId(index), ...row })),
  );
}

/** Answer the feed function with ranked ids. */
function stubFeed(
  backend: SupabaseBackend,
  items: Array<{ video_id: string; reason?: string; comprehension?: number }>,
  coldStart = false,
) {
  backend.stubFunction("discover-feed", {
    items: items.map((item, index) => ({
      video_id: item.video_id,
      score: 1 - index * 0.1,
      comprehension: item.comprehension ?? 0.8,
      reason: item.reason ?? "Matches your level",
      bucket: "match",
    })),
    cold_start: coldStart,
    seed: 1,
  });
}

/** Switch to the Browse tab. */
const browse = (page: Page) => page.getByRole("tab", { name: "تصفح" }).click();

/**
 * Switch to the For You tab.
 *
 * Needed explicitly because the page does not open on it — see "opens on
 * Browse even for a signed-in learner" below.
 */
const forYou = (page: Page) => page.getByRole("tab", { name: "لك" }).click();

test.describe("browsing the library", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    // No placement, so Browse defaults to "All" and the filters under test are
    // the only thing narrowing the list.
    db.seed("profiles", [aProfile({ placement_level: null, placement_level_gulf: null })]);
    stubFeed(backend, []);
  });

  test("lists published videos", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait" }, { title: "Market talk" }]);

    await page.goto("/discover");
    await browse(page);

    await expect(page.getByRole("button", { name: /Coffee in Kuwait/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Market talk/ })).toBeVisible();
  });

  test("hides an unpublished video", async ({ page, db }) => {
    seedVideos(db, [
      { title: "Live one", published: true },
      { title: "Draft one", published: false },
    ]);

    await page.goto("/discover");
    await browse(page);

    // Unpublished means unfinished — usually a video still being transcribed.
    await expect(page.getByRole("button", { name: /Live one/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Draft one/ })).toHaveCount(0);
  });

  test("narrows to a dialect", async ({ page, db }) => {
    seedVideos(db, [
      { title: "Gulf clip", dialect: "Gulf" },
      { title: "Egyptian clip", dialect: "Egyptian" },
    ]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "مصري", exact: true }).click();

    await expect(page.getByRole("button", { name: /Egyptian clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Gulf clip/ })).toHaveCount(0);
  });

  test("narrows to a difficulty", async ({ page, db }) => {
    seedVideos(db, [
      { title: "Easy clip", difficulty: "Beginner" },
      { title: "Hard clip", difficulty: "Advanced" },
    ]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "متقدم", exact: true }).click();

    await expect(page.getByRole("button", { name: /Hard clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Easy clip/ })).toHaveCount(0);
  });

  test("searches titles case-insensitively and by substring", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait" }, { title: "Market talk" }]);

    await page.goto("/discover");
    await browse(page);
    await page.getByLabel("ابحث عن فيديوهات").fill("coffee");

    // `ilike %term%` — a search that only matched a prefix, or matched case
    // exactly, would find nothing for most of what a learner types.
    await expect(page.getByRole("button", { name: /Coffee in Kuwait/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Market talk/ })).toHaveCount(0);
  });

  test("combines a search with a filter rather than replacing it", async ({ page, db }) => {
    seedVideos(db, [
      { title: "Coffee in Kuwait", dialect: "Gulf" },
      { title: "Coffee in Cairo", dialect: "Egyptian" },
    ]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "مصري", exact: true }).click();
    await page.getByLabel("ابحث عن فيديوهات").fill("coffee");

    await expect(page.getByRole("button", { name: /Coffee in Cairo/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Coffee in Kuwait/ })).toHaveCount(0);
  });

  test("says so when nothing matches", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait" }]);

    await page.goto("/discover");
    await browse(page);
    await page.getByLabel("ابحث عن فيديوهات").fill("nothing like this");

    await expect(page.getByText("لم يتم العثور على فيديوهات")).toBeVisible();
  });

  test("does not claim an empty library when the query failed", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedVideos(db, [{ title: "Coffee in Kuwait" }]);
    db.failAlways("discover_videos", 500);

    await page.goto("/discover");
    await browse(page);

    // "Check back later for new content" after a failed request tells the
    // learner the catalogue is empty when it is full.
    await expect(page.getByText("لم يتم العثور على فيديوهات")).toHaveCount(0);
  });

  test("opens a video", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait" }]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("button", { name: /Coffee in Kuwait/ }).click();

    await expect(page).toHaveURL(new RegExp(`/discover/${videoId(0)}$`));
  });

  test("labels each card with what it is, for a screen reader", async ({ page, db }) => {
    seedVideos(db, [{ title: "Coffee in Kuwait", dialect: "Gulf", difficulty: "Beginner" }]);

    await page.goto("/discover");
    await browse(page);

    // A grid of thumbnails is unusable without this — the accessible name is
    // the only thing distinguishing one card from the next.
    await expect(
      page.getByRole("button", { name: "فيديو: Coffee in Kuwait — Gulf, Beginner" }),
    ).toBeVisible();
  });
});

test.describe("the difficulty a learner starts on", () => {
  test.beforeEach(async ({ signInAs, backend }) => {
    await signInAs("free");
    stubFeed(backend, []);
  });

  test("never actually defaults to the placement level", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ placement_level_gulf: "C1" })]);
    seedVideos(db, [
      { title: "Easy clip", difficulty: "Beginner" },
      { title: "Hard clip", difficulty: "Advanced" },
    ]);

    await page.goto("/discover");
    await browse(page);

    // Recording current behaviour. Discover.tsx initialises the difficulty
    // filter from useUserLevel inside a useState initialiser, which runs on the
    // first render — before the profile query has resolved. hasTakenPlacement
    // is therefore always false at that moment, the filter locks to "All", and
    // nothing ever revises it. A C1 learner gets the beginner catalogue, which
    // is exactly what the code was written to prevent.
    //
    // This test fails once the default is derived rather than initialised.
    await expect(page.getByRole("button", { name: /Easy clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Hard clip/ })).toBeVisible();
  });

  test("shows everything to a learner who has not placed", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ placement_level: null, placement_level_gulf: null })]);
    seedVideos(db, [
      { title: "Easy clip", difficulty: "Beginner" },
      { title: "Hard clip", difficulty: "Advanced" },
    ]);

    await page.goto("/discover");
    await browse(page);

    await expect(page.getByRole("button", { name: /Easy clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Hard clip/ })).toBeVisible();
  });

  test("narrows once the learner picks a level themselves", async ({ page, db }) => {
    db.seed("profiles", [aProfile({ placement_level_gulf: "C1" })]);
    seedVideos(db, [
      { title: "Easy clip", difficulty: "Beginner" },
      { title: "Hard clip", difficulty: "Advanced" },
    ]);

    await page.goto("/discover");
    await browse(page);
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "متقدم", exact: true }).click();

    await expect(page.getByRole("button", { name: /Hard clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Easy clip/ })).toHaveCount(0);
  });
});

test.describe("the personalised feed", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
  });

  test("opens on Browse even for a signed-in learner", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Ranked clip" }]);
    stubFeed(backend, [{ video_id: videoId(0) }]);

    await page.goto("/discover");

    // Recording current behaviour, and the same mistake as the difficulty
    // default above. `useState(user ? "feed" : "browse")` runs on the first
    // render, when useAuth has not resolved and `user` is null, so the tab
    // locks to Browse and nothing revises it. The personalised feed the page
    // is built around is never what a learner lands on.
    //
    // This test fails once the tab is derived from the resolved session.
    await expect(page.getByRole("tab", { name: "تصفح" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("hydrates each ranked id from the table", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "First pick" }, { title: "Second pick" }]);
    stubFeed(backend, [{ video_id: videoId(1) }, { video_id: videoId(0) }]);

    await page.goto("/discover");
    await forYou(page);

    // The function returns ids and scores only; the titles, thumbnails and
    // badges all come from the table.
    await expect(page.getByRole("button", { name: /First pick/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Second pick/ })).toBeVisible();
  });

  test("shows the reason a video was picked", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Ranked clip" }]);
    stubFeed(backend, [{ video_id: videoId(0), reason: "Because you saved قهوة" }]);

    await page.goto("/discover");
    await forYou(page);

    await expect(page.getByText("Because you saved قهوة")).toBeVisible();
  });

  test("drops a ranked id the table cannot resolve", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Real clip" }]);
    stubFeed(backend, [{ video_id: videoId(0) }, { video_id: videoId(7) }]);

    await page.goto("/discover");
    await forYou(page);

    // A deleted or unpublished video still in the ranking must vanish, not
    // render as a card with no title that goes nowhere.
    await expect(page.getByRole("button", { name: /Real clip/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^فيديو: —/ })).toHaveCount(0);
  });

  test("explains a cold start rather than looking broken", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Trending clip" }]);
    stubFeed(backend, [{ video_id: videoId(0) }], true);

    await page.goto("/discover");
    await forYou(page);

    await expect(page.getByText(/اختبار تحديد المستوى/)).toBeVisible();
  });

  test("re-ranks with a new seed when shuffled", async ({ page, backend, db }) => {
    seedVideos(db, [{ title: "Ranked clip" }]);
    stubFeed(backend, [{ video_id: videoId(0) }]);

    await page.goto("/discover");
    await forYou(page);
    await expect(page.getByRole("button", { name: /Ranked clip/ })).toBeVisible();

    await page.getByRole("button", { name: "خلط" }).click();

    await expect.poll(() => backend.callsTo("discover-feed").length).toBe(2);
    const calls = backend.callsTo("discover-feed");
    const seeds = calls.map((call) => (call.body as { seed: number }).seed);
    // A shuffle that reused the seed would return the identical ranking and
    // read as a dead button.
    expect(seeds[1]).not.toBe(seeds[0]);
  });

  test("says so when there is nothing to recommend yet", async ({ page, backend, db }) => {
    seedVideos(db, []);
    stubFeed(backend, []);

    await page.goto("/discover");
    await forYou(page);

    await expect(page.getByText("لا توجد اختيارات مخصصة بعد")).toBeVisible();
  });

  test("is not offered to a signed-out visitor", async ({ page, signInAs, backend, db }) => {
    await signInAs("anonymous");
    seedVideos(db, [{ title: "Public clip" }]);

    await page.goto("/discover");

    // The feed is per-learner, so there is nothing to rank. Browse still works.
    await expect(page.getByRole("tab", { name: "لك" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Public clip/ })).toBeVisible();
    expect(backend.callsTo("discover-feed")).toHaveLength(0);
  });
});

test.describe("requesting content", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
    db.seed("content_requests", []);
    stubFeed(backend, []);
    seedVideos(db, []);
  });

  /**
   * Submitted with Enter rather than the send control, which is an icon-only
   * button with no accessible name — one of the unlabelled buttons the a11y
   * baseline already counts. Enter is a path the component supports on purpose.
   */
  /** The request input, distinguished from the Browse search box beside it. */
  const requestBox = (page: Page) => page.getByPlaceholder(/describe a video|creator|topic/i);

  async function submitRequest(page: Page, text: string) {
    await page.getByRole("button", { name: /اطلب محتوى/ }).click();
    await requestBox(page).fill(text);
    await requestBox(page).press("Enter");
  }

  test("records what the learner asked for", async ({ page, db }) => {
    await page.goto("/discover");
    await submitRequest(page, "More Kuwaiti cooking shows please");

    await expect(page.getByText(/تم إرسال الطلب/)).toBeVisible();

    const request = db.rows("content_requests")[0];
    expect(request.user_id).toBe(TEST_USER_ID);
    expect(request.body).toBe("More Kuwaiti cooking shows please");
    expect(request.request_type).toBe("video");
  });

  test("records which kind of thing was asked for", async ({ page, db }) => {
    await page.goto("/discover");
    await page.getByRole("button", { name: /اطلب محتوى/ }).click();
    await page.getByRole("button", { name: "صانع محتوى", exact: true }).click();
    await requestBox(page).fill("Anything by this creator");
    await requestBox(page).press("Enter");

    await expect(page.getByText(/تم إرسال الطلب/)).toBeVisible();
    // The type is what routes the request to the right admin queue; defaulting
    // everything to "video" would bury creator and topic asks.
    expect(db.rows("content_requests")[0].request_type).toBe("creator");
  });

  test("caps the request at the length the column accepts", async ({ page, db }) => {
    await page.goto("/discover");
    await submitRequest(page, "x".repeat(600));

    await expect(page.getByText(/تم إرسال الطلب/)).toBeVisible();
    // The input carries maxLength=500, so the over-length text is truncated
    // before it reaches the handler and the handler's own "too long" guard
    // never fires. Belt and braces rather than dead code — the guard still
    // covers a paste that bypasses the attribute — but what a learner actually
    // experiences is a silent truncation.
    expect(String(db.rows("content_requests")[0].body)).toHaveLength(500);
  });

  test("keeps the text when the submission fails", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/Request error/]);

    await page.goto("/discover");
    db.failWrites("content_requests", 500);
    await submitRequest(page, "More Kuwaiti cooking shows please");

    await expect(page.getByText(/تعذّر إرسال الطلب/)).toBeVisible();
    // Clearing the box on failure would make the learner retype it.
    await expect(requestBox(page)).toHaveValue("More Kuwaiti cooking shows please");
  });
});
