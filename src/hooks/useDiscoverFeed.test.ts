import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aDiscoverVideo, TEST_USER_ID, videoId } from "@/test/support/factories";
import { useDiscoverFeed, useRecordVideoView } from "./useDiscoverFeed";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The personalised Discover feed.
 *
 * Comprehensible input is the whole theory behind this screen: a clip a little
 * above what the learner can already follow is where acquisition happens, and
 * one far above it is noise they will stop watching. So the ranking is done
 * server-side against what they know, and each item comes back with a bucket —
 * match, stretch, comfort, fresh — that the UI uses to explain why it is there.
 *
 * The function returns rankings, not videos. Hydrating those ids against
 * `discover_videos` is this hook's job, and the join is where a ranked clip can
 * silently vanish.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const aRanking = (index: number, over: Record<string, unknown> = {}) => ({
  video_id: videoId(index),
  score: 0.8,
  comprehension: 0.7,
  reason: "Matches your level",
  bucket: "match",
  ...over,
});

function render(seed: (backend: SupabaseBackend) => void, seedValue = 7) {
  const harness = renderHookWithProviders(
    () => ({ feed: useDiscoverFeed(seedValue), record: useRecordVideoView() }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  return harness;
}

describe("building the feed", () => {
  it("pairs each ranking with the video it names", async () => {
    const { result } = render((backend) => {
      backend.stubFunction("discover-feed", { items: [aRanking(0)], seed: 7 });
      backend.db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), title: "A clip" })]);
    });

    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    const [item] = result.current.feed.data!.items;
    // The ranking explains the choice and the video is the thing to watch;
    // neither is useful on its own.
    expect(item.video.title).toBe("A clip");
    expect(item.bucket).toBe("match");
    expect(item.reason).toBe("Matches your level");
  });

  it("keeps the order the ranker chose", async () => {
    const { result } = render((backend) => {
      backend.stubFunction("discover-feed", {
        items: [aRanking(2), aRanking(0), aRanking(1)],
      });
      backend.db.seed("discover_videos", [
        aDiscoverVideo({ id: videoId(0) }),
        aDiscoverVideo({ id: videoId(1) }),
        aDiscoverVideo({ id: videoId(2) }),
      ]);
    });

    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    // The hydration query returns rows in whatever order Postgres likes. The
    // feed's order is the recommendation, so it has to survive the join.
    expect(result.current.feed.data?.items.map((item) => item.video_id)).toEqual([
      videoId(2),
      videoId(0),
      videoId(1),
    ]);
  });

  it("drops a ranking whose video has gone", async () => {
    const { result } = render((backend) => {
      backend.stubFunction("discover-feed", { items: [aRanking(0), aRanking(1)] });
      backend.db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0) })]);
    });

    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    // A clip unpublished or deleted between ranking and hydration would
    // otherwise reach the grid as an undefined video and crash the card.
    expect(result.current.feed.data?.items.map((item) => item.video_id)).toEqual([videoId(0)]);
  });

  it("skips the hydration query when nothing was ranked", async () => {
    const { result, backend } = render((b) => b.stubFunction("discover-feed", { items: [] }));

    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    expect(result.current.feed.data?.items).toEqual([]);
    // An `in.()` with no ids is a query that can only return nothing.
    expect(backend.db.reads.filter((read) => read.table === "discover_videos")).toEqual([]);
  });

  it("asks for a page of two dozen", async () => {
    const { result, backend } = render((b) => b.stubFunction("discover-feed", { items: [] }));

    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    expect(backend.lastCallTo("discover-feed")?.body).toMatchObject({ limit: 24, seed: 7 });
  });
});

describe("the shuffle seed", () => {
  it("passes the caller's seed so a reshuffle is deliberate", async () => {
    const { result, backend } = render((b) => b.stubFunction("discover-feed", { items: [] }), 42);

    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    // The same seed gives the same feed, so scrolling back does not reorder
    // under the learner; a new seed is what the refresh button changes.
    expect(backend.lastCallTo("discover-feed")?.body).toMatchObject({ seed: 42 });
  });

  it("reports back the seed the server actually used", async () => {
    const { result } = render((b) =>
      b.stubFunction("discover-feed", { items: [], seed: 99 }),
    );

    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    // The server may substitute its own; the caller needs the one in force to
    // ask for the same page again.
    expect(result.current.feed.data?.seed).toBe(99);
  });

  it("falls back to the seed it asked for", async () => {
    const { result } = render((b) => b.stubFunction("discover-feed", { items: [] }), 7);

    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    expect(result.current.feed.data?.seed).toBe(7);
  });
});

describe("a learner the ranker knows nothing about", () => {
  it("passes the cold-start flag through", async () => {
    const { result } = render((b) =>
      b.stubFunction("discover-feed", {
        items: [aRanking(0, { bucket: "fresh" })],
        cold_start: true,
      }),
    );
    // A learner with no watch history gets a generic feed, and the screen says
    // so rather than presenting it as personalised.
    await waitFor(() => expect(result.current.feed.data?.coldStart).toBe(true));
  });

  it("reports a warm feed as not cold", async () => {
    const { result } = render((b) => b.stubFunction("discover-feed", { items: [] }));

    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    // Coerced to a boolean, because the flag is absent rather than false on the
    // warm path and the banner branches on it.
    expect(result.current.feed.data?.coldStart).toBe(false);
  });
});

describe("when the feed cannot be built", () => {
  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useDiscoverFeed(7), { persona: "anonymous" });
    cleanup = harness.cleanup;

    // Ranking is against a learner's own history; there is nothing to rank on.
    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });

  it("surfaces a refused ranking call", async () => {
    const { result } = render((b) => b.stubFunctionFailure("discover-feed", 500));

    await waitFor(() => expect(result.current.feed.isError).toBe(true));
  });

  it("surfaces a failed hydration rather than an empty feed", async () => {
    const { result } = render((backend) => {
      backend.stubFunction("discover-feed", { items: [aRanking(0)] });
      backend.db.failAlways("discover_videos", 500, { message: "boom" });
    });

    // An empty grid reads as "nothing to watch", which is the one thing a
    // discovery feed must never say by accident.
    await waitFor(() => expect(result.current.feed.isError).toBe(true));
  });
});

describe("recording what was watched", () => {
  it("upserts one row per learner and video", async () => {
    const { result, backend } = render((b) => b.stubFunction("discover-feed", { items: [] }));
    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));

    await result.current.record.mutateAsync({
      videoId: videoId(0),
      watchedSeconds: 42.7,
      completed: true,
    });

    const write = backend.db.lastWriteTo("video_views")!;
    expect(write.payload[0]).toMatchObject({
      user_id: TEST_USER_ID,
      video_id: videoId(0),
      // Rounded, because the column is an integer and the caller reports a
      // player's fractional position.
      watched_seconds: 43,
      completed: true,
    });
  });

  it("records an unfinished watch as not completed", async () => {
    const { result, backend } = render((b) => b.stubFunction("discover-feed", { items: [] }));
    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));

    await result.current.record.mutateAsync({ videoId: videoId(0), watchedSeconds: 5 });

    // False rather than undefined: "watched five seconds and stopped" is the
    // strongest negative signal the ranker has.
    expect(backend.db.lastWriteTo("video_views")?.payload[0]).toMatchObject({ completed: false });
  });

  it("overwrites the previous view rather than stacking rows", async () => {
    const { result, backend } = render((b) => b.stubFunction("discover-feed", { items: [] }));
    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));

    await result.current.record.mutateAsync({ videoId: videoId(0), watchedSeconds: 5 });
    await result.current.record.mutateAsync({ videoId: videoId(0), watchedSeconds: 60 });

    // The caller throttles but still calls repeatedly during playback. Without
    // the conflict target each tick would be a new row, and watch time would
    // read as a dozen separate sessions.
    expect(backend.db.rows("video_views")).toHaveLength(1);
    expect(backend.db.rows("video_views")[0]).toMatchObject({ watched_seconds: 60 });
  });

  it("refreshes the feed so the ranking reflects the watch", async () => {
    const { result, backend } = render((b) => b.stubFunction("discover-feed", { items: [] }));
    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    const before = backend.callsTo("discover-feed").length;

    await result.current.record.mutateAsync({ videoId: videoId(0), watchedSeconds: 60 });

    await waitFor(() =>
      expect(backend.callsTo("discover-feed").length).toBeGreaterThan(before),
    );
  });

  it("writes nothing for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useRecordVideoView(), { persona: "anonymous" });
    cleanup = harness.cleanup;

    await act(async () => {
      await harness.result.current.mutateAsync({ videoId: videoId(0), watchedSeconds: 5 });
    });

    expect(harness.backend.db.writesTo("video_views")).toEqual([]);
  });

  it("reports a rejected write", async () => {
    const { result, backend } = render((b) => b.stubFunction("discover-feed", { items: [] }));
    await waitFor(() => expect(result.current.feed.isSuccess).toBe(true));
    backend.db.failWrites("video_views", 403, { message: "denied" });

    await expect(
      result.current.record.mutateAsync({ videoId: videoId(0), watchedSeconds: 5 }),
    ).rejects.toBeTruthy();
  });
});
