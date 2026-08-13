import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { aDiscoverVideo, videoId } from "@/test/support/factories";
import { useAuth } from "./useAuth";
import {
  useIsVideoLiked,
  useLikeVideo,
  useLikedVideos,
  useUnlikeVideo,
  useVideoLikeCount,
  useVideoLikes,
} from "./useVideoLikes";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Liking a Discover video.
 *
 * The like is both a private bookmark and a public count, and the two are read
 * through different queries — one filtered to the learner, one an exact count
 * with no rows returned at all. The count uses PostgREST's `head: true` with
 * `count=exact`, which returns the number in a `content-range` header and an
 * empty body; a client that read the body instead would show zero for every
 * video and nobody would notice, because most videos legitimately have none.
 *
 * The liked-videos list is the learner's own shelf, so it has to keep the order
 * they liked things in and drop anything that has since been unpublished.
 */

const OTHER_USER = "00000000-0000-4000-8000-000000000009";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const like = (user: string, video: string, likedAt: string) => ({
  id: `${user}-${video}`,
  user_id: user,
  video_id: video,
  created_at: likedAt,
});

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

function render<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(hook, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

/** Render a mutation and wait for the session, which it needs before it can run. */
async function renderMutation<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(() => ({ hook: hook(), user: useAuth().user }), {
    persona: "free",
    seed,
  });
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.user).toBeTruthy());
  return harness;
}

describe("which videos a learner has liked", () => {
  it("lists their own likes", async () => {
    const { result } = render(() => useVideoLikes(), (backend) => {
      backend.db.seed("video_likes", [
        like(TEST_USER_ID, videoId(0), at(1)),
        like(TEST_USER_ID, videoId(1), at(2)),
      ]);
    });

    await waitFor(() => expect(result.current.data).toEqual([videoId(0), videoId(1)]));
  });

  it("ignores somebody else's likes", async () => {
    const { result } = render(() => useVideoLikes(), (backend) => {
      backend.db.seed("video_likes", [
        like(TEST_USER_ID, videoId(0), at(1)),
        like(OTHER_USER, videoId(1), at(1)),
      ]);
    });

    await waitFor(() => expect(result.current.data).toEqual([videoId(0)]));
  });

  it("answers whether one video is liked", async () => {
    const { result } = render(() => useIsVideoLiked(videoId(0)), (backend) => {
      backend.db.seed("video_likes", [like(TEST_USER_ID, videoId(0), at(1))]);
    });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("answers false for a video that is not liked", async () => {
    const { result } = render(() => useIsVideoLiked(videoId(5)), (backend) => {
      backend.db.seed("video_likes", [like(TEST_USER_ID, videoId(0), at(1))]);
    });

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("answers false while nothing has loaded, rather than throwing", async () => {
    const { result } = render(() => useIsVideoLiked(undefined), (backend) => {
      backend.db.seed("video_likes", []);
    });

    // The heart renders before the query settles; undefined here would be
    // rendered as a React child and crash the card. Settling first keeps the
    // assertion from racing the query's own update.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current).toBe(false);
  });
});

describe("how many people liked a video", () => {
  it("counts every like, not just the learner's", async () => {
    const { result } = render(() => useVideoLikeCount(videoId(0)), (backend) => {
      backend.db.seed("video_likes", [
        like(TEST_USER_ID, videoId(0), at(1)),
        like(OTHER_USER, videoId(0), at(1)),
        like(OTHER_USER, videoId(1), at(1)),
      ]);
    });

    // Read from the `content-range` header, because the query asks for a count
    // with no rows. A client reading the body would see zero for everything.
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("reports zero for a video nobody has liked", async () => {
    const { result } = render(() => useVideoLikeCount(videoId(9)), (backend) => {
      backend.db.seed("video_likes", [like(TEST_USER_ID, videoId(0), at(1))]);
    });

    await waitFor(() => expect(result.current.data).toBe(0));
  });

  it("asks nothing without a video", async () => {
    const { result, backend } = render(() => useVideoLikeCount(undefined), (b) =>
      b.db.seed("video_likes", []),
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(backend.db.readsOf("video_likes")).toHaveLength(0);
  });
});

describe("liking and unliking", () => {
  it("records the like against the learner", async () => {
    const { result, backend } = await renderMutation(() => useLikeVideo(), (b) =>
      b.db.seed("video_likes", []),
    );

    await act(async () => {
      await result.current.hook.mutateAsync(videoId(0));
    });

    const row = backend.db.rows("video_likes")[0];
    expect(row.user_id).toBe(TEST_USER_ID);
    expect(row.video_id).toBe(videoId(0));
  });

  it("removes only this learner's like of this video", async () => {
    const { result, backend } = await renderMutation(() => useUnlikeVideo(), (b) =>
      b.db.seed("video_likes", [
        like(TEST_USER_ID, videoId(0), at(1)),
        like(TEST_USER_ID, videoId(1), at(1)),
        like(OTHER_USER, videoId(0), at(1)),
      ]),
    );

    await act(async () => {
      await result.current.hook.mutateAsync(videoId(0));
    });

    // Filtered on both columns. Dropping the user filter would unlike the video
    // for everyone; dropping the video filter would clear the learner's shelf.
    const remaining = backend.db.rows("video_likes");
    expect(remaining).toHaveLength(2);
    expect(
      remaining.some((row) => row.user_id === TEST_USER_ID && row.video_id === videoId(0)),
    ).toBe(false);
  });

  it("refuses to like when signed out", async () => {
    const harness = renderHookWithProviders(() => useLikeVideo(), {
      seed: (b) => b.db.seed("video_likes", []),
    });
    cleanup = harness.cleanup;

    await act(async () => {
      await expect(harness.result.current.mutateAsync(videoId(0))).rejects.toThrow(
        /not authenticated/i,
      );
    });
    expect(harness.backend.db.rows("video_likes")).toHaveLength(0);
  });
});

describe("the learner's shelf of liked videos", () => {
  const seedShelf = (backend: SupabaseBackend) => {
    backend.db.seed("discover_videos", [
      aDiscoverVideo({ id: videoId(0), title: "Liked first" }),
      aDiscoverVideo({ id: videoId(1), title: "Liked second" }),
    ]);
    backend.db.seed("video_likes", [
      like(TEST_USER_ID, videoId(1), at(1)),
      like(TEST_USER_ID, videoId(0), at(5)),
    ]);
  };

  it("returns the full video for each like", async () => {
    const { result } = render(() => useLikedVideos(), seedShelf);

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    // Titles and thumbnails come from discover_videos; the likes table holds
    // only ids.
    expect(result.current.data?.map((video) => video.title)).toContain("Liked first");
  });

  it("puts the most recently liked first", async () => {
    const { result } = render(() => useLikedVideos(), seedShelf);

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    // A shelf in database order rather than liked order buries whatever the
    // learner saved most recently.
    expect(result.current.data?.map((video) => video.title)).toEqual([
      "Liked second",
      "Liked first",
    ]);
  });

  it("drops a video that has since been unpublished", async () => {
    const { result } = render(() => useLikedVideos(), (backend) => {
      seedShelf(backend);
      backend.db.seed("discover_videos", [
        aDiscoverVideo({ id: videoId(0), title: "Liked first", published: true }),
        aDiscoverVideo({ id: videoId(1), title: "Pulled", published: false }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    // A card for a video that no longer plays is worse than one fewer card.
    expect(result.current.data?.[0].title).toBe("Liked first");
  });

  it("is empty when nothing is liked", async () => {
    const { result } = render(() => useLikedVideos(), (backend) => {
      backend.db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0) })]);
      backend.db.seed("video_likes", []);
    });

    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("can show another learner's shelf", async () => {
    const { result } = render(() => useLikedVideos(OTHER_USER), (backend) => {
      backend.db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), title: "Theirs" })]);
      backend.db.seed("video_likes", [
        like(OTHER_USER, videoId(0), at(1)),
        like(TEST_USER_ID, videoId(1), at(1)),
      ]);
    });

    // The hook takes an explicit user id for profile pages; defaulting to the
    // signed-in learner there would show visitors their own shelf.
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].title).toBe("Theirs");
  });
});
