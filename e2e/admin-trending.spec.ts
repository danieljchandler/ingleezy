import { expect, test } from "./support/fixtures";
import {
  aTrendingCandidate,
  candidateId,
  TEST_USER_ID,
} from "../src/test/support/factories";

/**
 * `/admin/trending` — the YouTube discovery queue.
 *
 * A crawler proposes candidates; an admin approves, rejects or dismisses each
 * one. Approving is the only three-step write in the admin: insert a
 * `discover_videos` row, mark the candidate processed, then fire
 * `process-approved-video` without waiting for it.
 *
 * The three state flags are independent — `processed`, `rejected` and
 * `dismissed` — and the tab filters combine them differently, which is exactly
 * the kind of thing that reads as "no candidates" when it goes wrong.
 */

/** A 1x1 transparent GIF, inline, so a thumbnail needs no network at all. */
const TRANSPARENT_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Eleven characters, which is what parseVideoUrl's YouTube pattern requires. */
const YOUTUBE_ID = "dQw4w9WgXcQ";

test.describe("the queue", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("says when nothing is waiting", async ({ page, db }) => {
    db.seed("trending_video_candidates", []);
    await page.goto("/admin/trending");

    await expect(page.getByRole("heading", { name: /trending videos/i })).toBeVisible();
    await expect(page.getByText(/no candidates found/i)).toBeVisible();
    await expect(page.getByText(/click "fetch trending"/i)).toBeVisible();
  });

  test("shows a candidate with everything the crawler found", async ({ page, db }) => {
    db.seed("trending_video_candidates", [
      aTrendingCandidate({
        title: "A funny street interview",
        creator_name: "Some Creator",
        // The score badge lives inside the thumbnail block, so a candidate the
        // crawler found no image for shows no score either. Inline data so the
        // hermetic host block never sees a request.
        thumbnail_url: TRANSPARENT_GIF,
        view_count: 1_500_000,
        trending_score: 9_400,
        detected_topic: "comedy",
        region_code: "US",
      }),
    ]);

    await page.goto("/admin/trending");

    await expect(page.getByText("A funny street interview")).toBeVisible();
    await expect(page.getByText("Some Creator")).toBeVisible();
    await expect(page.getByText("1.5M")).toBeVisible();
    await expect(page.getByText("Score: 9,400")).toBeVisible();
    await expect(page.getByText("comedy")).toBeVisible();
    await expect(page.getByTitle("United States")).toBeVisible();
  });

  test("abbreviates view counts by magnitude", async ({ page, db }) => {
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), title: "millions", view_count: 2_400_000 }),
      aTrendingCandidate({ id: candidateId(1), title: "thousands", view_count: 12_300, video_id: "b" }),
      aTrendingCandidate({ id: candidateId(2), title: "hundreds", view_count: 940, video_id: "c" }),
      aTrendingCandidate({ id: candidateId(3), title: "unknown", view_count: null, video_id: "d" }),
    ]);

    await page.goto("/admin/trending");

    await expect(page.getByText("2.4M")).toBeVisible();
    await expect(page.getByText("12.3K")).toBeVisible();
    await expect(page.getByText("940")).toBeVisible();
    await expect(page.getByText("—")).toBeVisible();
  });

  test("shows no view count for a video with zero views", async ({ page, db }) => {
    // Pinned, not fixed. `formatViews` guards with `if (!count)`, so a genuine
    // zero renders as the same em dash as a missing count — a brand-new upload
    // is indistinguishable from one the crawler could not read.
    db.seed("trending_video_candidates", [aTrendingCandidate({ view_count: 0 })]);
    await page.goto("/admin/trending");

    await expect(page.getByText("—")).toBeVisible();
    await expect(page.getByText("0", { exact: true })).toHaveCount(0);
  });

  test("ranks by trending score", async ({ page, db }) => {
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), title: "quieter", trending_score: 10 }),
      aTrendingCandidate({ id: candidateId(1), title: "louder", trending_score: 999, video_id: "b" }),
    ]);

    await page.goto("/admin/trending");

    const titles = page.locator("h3");
    await expect(titles.first()).toHaveText("louder");
    await expect(titles.last()).toHaveText("quieter");
  });

  test("shows the failure rather than an empty queue", async ({ page, db }) => {
    db.seed("trending_video_candidates", [aTrendingCandidate()]);
    db.failAlways("trending_video_candidates", 500);

    await page.goto("/admin/trending");

    await expect(page.getByText(/failed to load candidates/i)).toBeVisible();
    await expect(page.getByText(/no candidates found/i)).toHaveCount(0);
  });

  test("links out to the original video", async ({ page, db }) => {
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ url: "https://www.youtube.com/watch?v=abc123" }),
    ]);
    await page.goto("/admin/trending");

    await expect(page.getByRole("link")).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abc123",
    );
    await expect(page.getByRole("link")).toHaveAttribute("target", "_blank");
  });
});

test.describe("the filters", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), title: "untouched", video_id: "a" }),
      aTrendingCandidate({ id: candidateId(1), title: "already approved", video_id: "b", processed: true }),
      aTrendingCandidate({ id: candidateId(2), title: "turned down", video_id: "c", rejected: true }),
      aTrendingCandidate({ id: candidateId(3), title: "hidden", video_id: "d", dismissed: true }),
    ]);
  });

  test("opens on what still needs a decision", async ({ page }) => {
    await page.goto("/admin/trending");

    await expect(page.getByText("untouched")).toBeVisible();
    await expect(page.getByText("already approved")).toHaveCount(0);
    await expect(page.getByText("turned down")).toHaveCount(0);
  });

  test("shows the approved ones", async ({ page }) => {
    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Approved" }).click();

    await expect(page.getByText("already approved")).toBeVisible();
    await expect(page.getByText("untouched")).toHaveCount(0);
  });

  test("shows the rejected ones", async ({ page }) => {
    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Rejected" }).click();

    await expect(page.getByText("turned down")).toBeVisible();
  });

  test("never shows a dismissed candidate, even under All", async ({ page }) => {
    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "All", exact: true }).click();

    await expect(page.getByText("untouched")).toBeVisible();
    await expect(page.getByText("already approved")).toBeVisible();
    await expect(page.getByText("turned down")).toBeVisible();
    await expect(page.getByText("hidden")).toHaveCount(0);
  });

  test("narrows by region, and says so in the URL", async ({ page, db }) => {
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), title: "a US clip", region_code: "US" }),
      aTrendingCandidate({ id: candidateId(1), title: "a UK clip", region_code: "GB", video_id: "b" }),
    ]);

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: /United Kingdom/ }).click();

    await expect(page).toHaveURL(/\?region=GB$/);
    await expect(page.getByText("a UK clip")).toBeVisible();
    await expect(page.getByText("a US clip")).toHaveCount(0);
  });

  test("restores the region from the URL on load", async ({ page, db }) => {
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), title: "a US clip", region_code: "US" }),
      aTrendingCandidate({ id: candidateId(1), title: "a UK clip", region_code: "GB", video_id: "b" }),
    ]);

    await page.goto("/admin/trending?region=US");

    await expect(page.getByText("a US clip")).toBeVisible();
    await expect(page.getByText("a UK clip")).toHaveCount(0);
  });

  test("clears the region back out of the URL", async ({ page, db }) => {
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), title: "a US clip", region_code: "US" }),
    ]);

    await page.goto("/admin/trending?region=GB");
    await expect(page.getByText(/no candidates found/i)).toBeVisible();

    await page.getByRole("button", { name: /all regions/i }).click();

    await expect(page).toHaveURL(/\/admin\/trending$/);
    await expect(page.getByText("a US clip")).toBeVisible();
  });

  test("filters by region without asking the server again", async ({ page, db }) => {
    // The region filter is applied in the component; only the status tabs are
    // part of the query key. A region switch that refetched would cost a round
    // trip per click.
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), region_code: "US" }),
    ]);
    await page.goto("/admin/trending");
    await expect(page.getByText("A trending clip")).toBeVisible();
    const before = db.readsOf("trending_video_candidates").length;

    await page.getByRole("button", { name: /United Kingdom/ }).click();

    await expect(page.getByText(/no candidates found/i)).toBeVisible();
    expect(db.readsOf("trending_video_candidates")).toHaveLength(before);
  });
});

test.describe("approving a candidate", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("discover_videos", []);
    db.seed("trending_video_candidates", [
      aTrendingCandidate({
        id: candidateId(0),
        title: "لقطة مضحكة",
        // A real-shaped id: parseVideoUrl only matches an 11-character YouTube
        // id, and falls back to the raw URL as the embed when it does not.
        url: `https://www.youtube.com/watch?v=${YOUTUBE_ID}`,
        duration_seconds: 45,
      }),
    ]);
  });

  test("creates an unpublished video from the candidate", async ({ page, db }) => {
    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(page.getByText(/video approved/i)).toBeVisible();
    const written = db.lastWriteTo("discover_videos")?.payload[0];
    expect(written).toMatchObject({
      title: "لقطة مضحكة",
      source_url: `https://www.youtube.com/watch?v=${YOUTUBE_ID}`,
      platform: "youtube",
      duration_seconds: 45,
      dialect: "Gulf",
      published: false,
      transcription_status: "pending",
      created_by: TEST_USER_ID,
      trending_candidate_id: candidateId(0),
    });
    // The embed is rebuilt through youtube-nocookie so the player never sets a
    // consent cookie for a learner who only wanted to watch a clip.
    expect(written?.embed_url).toContain(
      `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`,
    );
    expect(written?.thumbnail_url).toContain(YOUTUBE_ID);
  });

  test("marks the candidate processed so it leaves the queue", async ({ page, db }) => {
    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(page.getByText(/video approved/i)).toBeVisible();
    expect(db.rows("trending_video_candidates")[0]).toMatchObject({ processed: true });
    await expect(page.getByText(/no candidates found/i)).toBeVisible();
  });

  test("starts the transcription pipeline for the new video", async ({ page, db, backend }) => {
    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(page.getByText(/transcription pipeline started/i)).toBeVisible();
    await expect
      .poll(() => backend.callsTo("process-approved-video").length)
      .toBe(1);
    const created = db.rows("discover_videos")[0];
    expect(backend.lastCallTo("process-approved-video")?.body).toMatchObject({
      videoId: created.id,
    });
  });

  test("still reports success when the pipeline call fails", async ({
    page,
    db,
    backend,
    expectConsoleErrors,
  }) => {
    // Pinned, not fixed. The invoke is deliberately not awaited and its
    // rejection only reaches console.error — so a video whose pipeline never
    // started looks approved and sits at `transcription_status: "pending"`
    // forever, with nothing on this page to say so.
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("process-approved-video", 500);

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(page.getByText(/video approved/i)).toBeVisible();
    expect(db.rows("discover_videos")[0]).toMatchObject({ transcription_status: "pending" });
  });

  test("reports a rejected insert and leaves the candidate alone", async ({ page, db }) => {
    db.failWrites("discover_videos", 403);

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(page.getByText(/approve failed/i)).toBeVisible();
    expect(db.rows("trending_video_candidates")[0]).toMatchObject({ processed: false });
  });

  test("leaves the video behind when marking the candidate fails", async ({ page, db }) => {
    // Pinned, not fixed. The three steps are not a transaction: if the update
    // is rejected after the insert, the discover_videos row stays and the
    // candidate stays in the New tab, so approving again creates a duplicate.
    db.failWrites("trending_video_candidates", 403);

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(page.getByText(/approve failed/i)).toBeVisible();
    expect(db.rows("discover_videos")).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  });
});

test.describe("rejecting and dismissing", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("discover_videos", []);
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), title: "not for us" }),
    ]);
  });

  test("rejecting records why", async ({ page, db }) => {
    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Reject", exact: true }).click();

    await expect(page.getByText(/video rejected/i)).toBeVisible();
    expect(db.rows("trending_video_candidates")[0]).toMatchObject({
      rejected: true,
      rejection_reason: "manually_rejected",
    });
  });

  test("a rejected candidate moves to the Rejected tab", async ({ page }) => {
    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Reject", exact: true }).click();

    await expect(page.getByText(/no candidates found/i)).toBeVisible();
    await page.getByRole("button", { name: "Rejected" }).click();
    await expect(page.getByText("not for us")).toBeVisible();
  });

  test("dismissing hides the row without deleting it", async ({ page, db }) => {
    // Soft delete on purpose: the row keeps the video_id in the unique index,
    // so the next crawl cannot re-propose the same video.
    await page.goto("/admin/trending");
    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByText(/won't appear again/i)).toBeVisible();
    expect(db.rows("trending_video_candidates")).toHaveLength(1);
    expect(db.rows("trending_video_candidates")[0]).toMatchObject({ dismissed: true });
  });

  test("dismissing takes no confirmation at all", async ({ page, db }) => {
    // Pinned, not fixed. One click on an unlabelled bin icon removes a
    // candidate from every tab with no dialog and no undo — the only
    // destructive control in the admin without a confirmation step.
    await page.goto("/admin/trending");
    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByText(/won't appear again/i)).toBeVisible();
    expect(db.writesTo("trending_video_candidates")).toHaveLength(1);
  });

  test("an approved candidate offers no further decision", async ({ page, db }) => {
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), processed: true }),
    ]);

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: "Approved" }).click();

    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
    await expect(page.locator("button:has(svg.lucide-trash2)")).toBeVisible();
  });
});

test.describe("fetching new candidates", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("trending_video_candidates", []);
  });

  test("stores what the crawler returned", async ({ page, db, backend }) => {
    backend.stubFunction("discover-trending-videos", {
      success: true,
      candidates_found: 2,
      region_summary: { US: 1, GB: 1 },
      candidates: [
        {
          platform: "youtube",
          video_id: "one",
          url: "https://www.youtube.com/watch?v=one",
          title: "first",
          creator_name: "A",
          region_code: "US",
          view_count: 100,
          trending_score: 50,
        },
        {
          platform: "youtube",
          video_id: "two",
          url: "https://www.youtube.com/watch?v=two",
          title: "second",
          creator_name: "B",
          region_code: "GB",
        },
      ],
    });

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: /fetch trending/i }).click();

    await expect(page.getByText("Found 2 new candidates")).toBeVisible();
    await expect(page.getByText("🇺🇸 1  🇬🇧 1")).toBeVisible();
    expect(db.rows("trending_video_candidates")).toHaveLength(2);
    await expect(page.getByText("first")).toBeVisible();
  });

  test("fills in the columns the crawler left out", async ({ page, db, backend }) => {
    backend.stubFunction("discover-trending-videos", {
      candidates_found: 1,
      candidates: [
        {
          platform: "youtube",
          video_id: "one",
          url: "https://www.youtube.com/watch?v=one",
          title: "first",
          creator_name: "A",
        },
      ],
    });

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: /fetch trending/i }).click();

    await expect(page.getByText("Found 1 new candidates")).toBeVisible();
    expect(db.lastWriteTo("trending_video_candidates")?.payload[0]).toMatchObject({
      creator_handle: null,
      thumbnail_url: null,
      view_count: null,
      trending_score: null,
      detected_topic: null,
      region_code: null,
      duration_seconds: null,
    });
  });

  test("writes nothing when the crawler found nothing", async ({ page, db }) => {
    await page.goto("/admin/trending");
    await page.getByRole("button", { name: /fetch trending/i }).click();

    await expect(page.getByText("Found 0 new candidates")).toBeVisible();
    expect(db.writesTo("trending_video_candidates")).toHaveLength(0);
  });

  test("will not resurrect a candidate that was already ruled on", async ({
    page,
    db,
    backend,
  }) => {
    // The upsert ignores duplicates on (platform, video_id), which is what
    // stops a rejected or dismissed video coming back as new on every crawl.
    db.seed("trending_video_candidates", [
      aTrendingCandidate({ id: candidateId(0), video_id: "one", rejected: true, title: "turned down" }),
    ]);
    backend.stubFunction("discover-trending-videos", {
      candidates_found: 1,
      candidates: [
        {
          platform: "youtube",
          video_id: "one",
          url: "https://www.youtube.com/watch?v=one",
          title: "turned down",
          creator_name: "A",
        },
      ],
    });

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: /fetch trending/i }).click();

    await expect(page.getByText("Found 1 new candidates")).toBeVisible();
    expect(db.rows("trending_video_candidates")).toHaveLength(1);
    expect(db.rows("trending_video_candidates")[0]).toMatchObject({ rejected: true });
    await expect(page.getByText(/no candidates found/i)).toBeVisible();
  });

  test("reports a failed crawl", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("discover-trending-videos", 500);

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: /fetch trending/i }).click();

    await expect(page.getByText(/fetch failed/i)).toBeVisible();
  });

  test("reports a rejected write", async ({ page, db, backend }) => {
    backend.stubFunction("discover-trending-videos", {
      candidates_found: 1,
      candidates: [
        {
          platform: "youtube",
          video_id: "one",
          url: "https://www.youtube.com/watch?v=one",
          title: "first",
          creator_name: "A",
        },
      ],
    });
    db.failWrites("trending_video_candidates", 403);

    await page.goto("/admin/trending");
    await page.getByRole("button", { name: /fetch trending/i }).click();

    await expect(page.getByText(/fetch failed/i)).toBeVisible();
    await expect(page.getByText(/found 1 new candidates/i)).toHaveCount(0);
  });
});

test.describe("who can open it", () => {
  test.beforeEach(async ({ db }) => {
    db.seed("trending_video_candidates", []);
  });

  test("a recorder may curate", async ({ page, signInAs }) => {
    await signInAs("recorder");
    await page.goto("/admin/trending");

    await expect(page.getByRole("heading", { name: /trending videos/i })).toBeVisible();
  });

  test("a content reviewer is turned away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");
    await page.goto("/admin/trending");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(/access denied/i)).toBeVisible();
  });

  test("a signed-in learner is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/admin/trending");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
