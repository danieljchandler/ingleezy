import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The liked-videos shelf.
 *
 * Two queries and a re-sort in JavaScript: the likes carry the order, the
 * videos carry the content, and the page puts them back together by mapping
 * over the like order rather than over the video rows. That is the only reason
 * "most recently liked first" survives — PostgREST returns the `.in(...)` set
 * in whatever order it likes, so sorting by the second query would be sorting
 * by nothing in particular.
 *
 * The same re-sort silently drops a video that was liked and later
 * unpublished, which is the behaviour worth pinning: the row still exists, the
 * like still exists, and the shelf is quietly one shorter.
 */

const videoId = (n: number) => `aaaaaaaa-4444-4000-8000-00000000000${n}`;

const aVideo = (n: number, over: Record<string, unknown> = {}) => ({
  id: videoId(n),
  title: `Video ${n}`,
  title_arabic: null,
  // `embed_url` and `source_url`, not a bare `youtube_id` — the table predates
  // being YouTube-only and carries the platform separately.
  platform: "youtube",
  embed_url: `https://www.youtube.com/embed/yt${n}`,
  source_url: `https://youtube.com/watch?v=yt${n}`,
  // A data: URI rather than a CDN host: the hermetic guard blocks every
  // foreign origin, and a blocked thumbnail is indistinguishable from a page
  // trying to reach somewhere it should not.
  thumbnail_url:
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  duration_seconds: 90 + n,
  dialect: "Gulf",
  difficulty: "Beginner",
  cefr_level: null,
  cultural_context: null,
  difficulty_metrics: null,
  difficulty_rationale: null,
  engines_used: null,
  grammar_points: [],
  vocabulary: [],
  transcript_lines: [],
  transcription_status: "complete",
  transcription_error: null,
  trending_candidate_id: null,
  is_meme: false,
  published: true,
  created_by: TEST_USER_ID,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

const aLike = (n: number, over: Record<string, unknown> = {}) => ({
  id: `bbbbbbbb-4444-4000-8000-00000000000${n}`,
  user_id: TEST_USER_ID,
  video_id: videoId(n),
  created_at: new Date(Date.now() - n * 3_600_000).toISOString(),
  ...over,
});

function seedLikes(
  db: MemoryDb,
  videos: Array<Record<string, unknown>>,
  likes: Array<Record<string, unknown>>,
) {
  db.seed("discover_videos", videos);
  db.seed("video_likes", likes);
}

test.describe("reaching the shelf", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/liked-videos");

    await expect(page).toHaveURL(/\/auth/);
  });

  test("never reaches the page's own signed-out screen", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/liked-videos");
    await expect(page).toHaveURL(/\/auth/);

    // Same shape as Friends: the page has a "Sign in to see liked videos"
    // branch that ProtectedRoute makes unreachable. Harmless until somebody
    // relaxes the route guard on the strength of a screen nobody has seen.
    await expect(page.getByText("Sign in to see liked videos")).toHaveCount(0);
  });

  test("lets a learner in", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedLikes(db, [], []);

    await page.goto("/liked-videos");

    await expect(page.getByRole("heading", { name: "فيديوهات أعجبتني" })).toBeVisible();
  });
});

test.describe("the shelf", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows a liked video with its length", async ({ page, db }) => {
    seedLikes(db, [aVideo(1, { duration_seconds: 125 })], [aLike(1)]);

    await page.goto("/liked-videos");

    await expect(page.getByText("Video 1")).toBeVisible();
    await expect(page.getByText("2:05")).toBeVisible();
  });

  test("counts what has been liked", async ({ page, db }) => {
    seedLikes(db, [aVideo(1), aVideo(2)], [aLike(1), aLike(2)]);

    await page.goto("/liked-videos");

    await expect(page.getByText("فيديوهان أعجباك")).toBeVisible();
  });

  test("says one video rather than 1 videos", async ({ page, db }) => {
    seedLikes(db, [aVideo(1)], [aLike(1)]);

    await page.goto("/liked-videos");

    await expect(page.getByText("فيديو واحد أعجبك")).toBeVisible();
  });

  test("puts the most recently liked first", async ({ page, db }) => {
    seedLikes(
      db,
      [aVideo(1), aVideo(2), aVideo(3)],
      [
        aLike(1, { created_at: new Date(Date.now() - 3_600_000).toISOString() }),
        aLike(2, { created_at: new Date().toISOString() }),
        aLike(3, { created_at: new Date(Date.now() - 7_200_000).toISOString() }),
      ],
    );

    await page.goto("/liked-videos");
    await expect(page.getByText("Video 2")).toBeVisible();

    // The order comes from the likes query and is reapplied by mapping over
    // the like ids — the videos query returns its `.in(...)` set in no
    // particular order, so anything else would sort by nothing.
    const titles = await page.locator("p.line-clamp-2").allTextContents();
    expect(titles).toEqual(["Video 2", "Video 1", "Video 3"]);
  });

  test("drops a video that has since been unpublished", async ({ page, db }) => {
    seedLikes(db, [aVideo(1), aVideo(2, { published: false })], [aLike(1), aLike(2)]);

    await page.goto("/liked-videos");

    // The like still exists and so does the row; the second query filters on
    // `published` and the re-sort drops the miss. Worth knowing about because
    // the shelf just gets shorter — nothing says a video was pulled.
    await expect(page.getByText("Video 1")).toBeVisible();
    await expect(page.getByText("Video 2")).toHaveCount(0);
    await expect(page.getByText("فيديو واحد أعجبك")).toBeVisible();
  });

  test("points an empty shelf at Discover", async ({ page, db }) => {
    seedLikes(db, [aVideo(1)], []);

    await page.goto("/liked-videos");

    await expect(page.getByText("لا فيديوهات بعد")).toBeVisible();
    await page.getByRole("button", { name: /تصفّح المقاطع/ }).click();
    await expect(page).toHaveURL(/\/discover$/);
  });

  test("skips the video query when nothing is liked", async ({ page, db }) => {
    seedLikes(db, [aVideo(1)], []);

    await page.goto("/liked-videos");
    await expect(page.getByText("لا فيديوهات بعد")).toBeVisible();

    // An empty `.in([])` is a request that can only return nothing; the early
    // return is what keeps an empty shelf to one round trip.
    expect(db.readsOf("discover_videos")).toHaveLength(0);
  });

  test("shows nothing another learner liked", async ({ page, db }) => {
    seedLikes(
      db,
      [aVideo(1), aVideo(2)],
      [aLike(1), aLike(2, { user_id: "00000000-0000-4000-8000-0000000000ff" })],
    );

    await page.goto("/liked-videos");

    await expect(page.getByText("Video 1")).toBeVisible();
    await expect(page.getByText("Video 2")).toHaveCount(0);
  });

  test("opens a video", async ({ page, db }) => {
    seedLikes(db, [aVideo(1)], [aLike(1)]);

    await page.goto("/liked-videos");
    await page.getByText("Video 1").click();

    await expect(page).toHaveURL(new RegExp(`/discover/${videoId(1)}$`));
  });

  test("reports a failed load rather than an empty shelf", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedLikes(db, [aVideo(1)], [aLike(1)]);
    db.failAlways("video_likes", 500);

    await page.goto("/liked-videos");

    // Recording current behaviour: the query throws and the page falls through
    // to its empty state, so a broken read tells a learner they have liked
    // nothing. The count in the header says the same thing, which makes it
    // convincing.
    await expect(page.getByText("لا فيديوهات بعد")).toBeVisible();
  });
});
