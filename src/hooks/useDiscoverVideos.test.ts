import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aDiscoverVideo, daysAgo, videoId } from "@/test/support/factories";
import {
  difficultyWindow,
  useAdminDiscoverVideos,
  useDeleteDiscoverVideo,
  useDiscoverVideo,
  useDiscoverVideos,
  useTogglePublish,
} from "./useDiscoverVideos";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The Discover library: what a learner can browse, and what an admin can see
 * before it is published.
 *
 * The two lists differ in exactly one filter, and that filter is the whole
 * editorial process. A clip arrives from the trending crawler, gets transcribed
 * and vetted, and only then becomes visible — publishing an untranscribed clip
 * would put a video with no subtitles in a comprehension exercise.
 *
 * `difficultyWindow` is the other half: a learner placed at B1 is shown
 * Beginner through Advanced and not Expert, because the point is material just
 * beyond their level rather than material they cannot follow at all.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const seedVideos =
  (rows: Record<string, unknown>[]) =>
  (backend: SupabaseBackend) =>
    backend.db.seed("discover_videos", rows);

describe("choosing a difficulty window", () => {
  it("puts a beginner one step either side of their level", () => {
    // A1 sits at the bottom, so the window is only as wide as the ladder
    // allows.
    expect(difficultyWindow("A1")).toEqual(["Beginner", "Intermediate"]);
  });

  it("gives a mid-level learner a bucket on each side", () => {
    // The reason for ±1 rather than an exact match: a clip slightly above what
    // you can follow is where acquisition happens, and one slightly below is
    // the confidence that keeps you watching.
    expect(difficultyWindow("B1")).toEqual(["Beginner", "Intermediate", "Advanced"]);
  });

  it("clamps at the top of the ladder", () => {
    expect(difficultyWindow("C2")).toEqual(["Advanced", "Expert"]);
  });

  it("accepts a level in any case", () => {
    // Levels are written by hand in several places and arrive lower-cased often
    // enough to matter.
    expect(difficultyWindow("b2")).toEqual(difficultyWindow("B2"));
  });

  it("filters nothing for a learner who has not been placed", () => {
    // Null is "no filter", not "no videos": someone who has not taken the
    // placement quiz should still see the whole library rather than an empty
    // screen.
    expect(difficultyWindow(null)).toBeNull();
    expect(difficultyWindow(undefined)).toBeNull();
    expect(difficultyWindow("")).toBeNull();
  });

  it("filters nothing for a level off the CEFR scale", () => {
    expect(difficultyWindow("fluent")).toBeNull();
  });
});

describe("the learner's library", () => {
  it("shows only published clips, newest first", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideos(), {
      persona: "free",
      seed: seedVideos([
        aDiscoverVideo({ id: videoId(0), title: "Old", created_at: daysAgo(10) }),
        aDiscoverVideo({ id: videoId(1), title: "New", created_at: daysAgo(1) }),
        aDiscoverVideo({ id: videoId(2), title: "Draft", published: false }),
      ]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    // An unpublished clip is one nobody has vetted; newest first because the
    // library is a feed, not a catalogue.
    expect(harness.result.current.data?.map((video) => video.title)).toEqual(["New", "Old"]);
  });

  it("narrows to one dialect", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideos({ dialect: "Egyptian" }), {
      persona: "free",
      seed: seedVideos([
        aDiscoverVideo({ id: videoId(0), title: "Gulf clip", dialect: "Gulf" }),
        aDiscoverVideo({ id: videoId(1), title: "Egyptian clip", dialect: "Egyptian" }),
      ]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data?.map((video) => video.title)).toEqual(["Egyptian clip"]);
  });

  it("narrows to a whole difficulty window at once", async () => {
    const harness = renderHookWithProviders(
      () => useDiscoverVideos({ difficulty: ["Beginner", "Intermediate"] }),
      {
        persona: "free",
        seed: seedVideos([
          aDiscoverVideo({ id: videoId(0), title: "Easy", difficulty: "Beginner" }),
          aDiscoverVideo({ id: videoId(1), title: "Mid", difficulty: "Intermediate" }),
          aDiscoverVideo({ id: videoId(2), title: "Hard", difficulty: "Expert" }),
        ]),
      },
    );
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    // The array form is what pairs with `difficultyWindow`; without it the
    // level filter would have to be three separate queries.
    expect(harness.result.current.data?.map((video) => video.title)).toEqual(["Easy", "Mid"]);
  });

  it("narrows to a single difficulty when given one", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideos({ difficulty: "Beginner" }), {
      persona: "free",
      seed: seedVideos([
        aDiscoverVideo({ id: videoId(0), title: "Easy", difficulty: "Beginner" }),
        aDiscoverVideo({ id: videoId(1), title: "Hard", difficulty: "Expert" }),
      ]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data?.map((video) => video.title)).toEqual(["Easy"]);
  });

  it("treats an empty difficulty list as no filter", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideos({ difficulty: [] }), {
      persona: "free",
      seed: seedVideos([
        aDiscoverVideo({ id: videoId(0), difficulty: "Beginner" }),
        aDiscoverVideo({ id: videoId(1), difficulty: "Expert" }),
      ]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    // An `in.()` with nothing in it matches nothing, which would empty the
    // library the moment a learner cleared their filters.
    expect(harness.result.current.data).toHaveLength(2);
  });

  it("searches titles case-insensitively", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideos({ search: "SOUQ" }), {
      persona: "free",
      seed: seedVideos([
        aDiscoverVideo({ id: videoId(0), title: "At the souq" }),
        aDiscoverVideo({ id: videoId(1), title: "At the beach" }),
      ]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data?.map((video) => video.title)).toEqual(["At the souq"]);
  });

  it("is browsable by a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideos(), {
      persona: "anonymous",
      seed: seedVideos([aDiscoverVideo({ id: videoId(0) })]),
    });
    cleanup = harness.cleanup;

    // Discover is the app's shop window; gating it would hide the argument for
    // signing up.
    await waitFor(() => expect(harness.result.current.data).toHaveLength(1));
  });

  it("surfaces a failed read rather than an empty library", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideos(), {
      persona: "free",
      seed: (backend) => backend.db.failAlways("discover_videos", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });
});

describe("one clip", () => {
  it("returns it by id", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideo(videoId(0)), {
      persona: "free",
      seed: seedVideos([aDiscoverVideo({ id: videoId(0), title: "A clip" })]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.data?.title).toBe("A clip"));
  });

  it("returns an unpublished clip too", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideo(videoId(0)), {
      persona: "admin",
      seed: seedVideos([aDiscoverVideo({ id: videoId(0), published: false })]),
    });
    cleanup = harness.cleanup;

    // The detail route is how an admin previews a clip before publishing it, so
    // the published filter belongs on the list rather than here.
    await waitFor(() => expect(harness.result.current.data?.id).toBe(videoId(0)));
  });

  it("reports an id that names nothing", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideo(videoId(9)), {
      persona: "free",
      seed: seedVideos([]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });

  it("does not query without an id", async () => {
    const harness = renderHookWithProviders(() => useDiscoverVideo(undefined), {
      persona: "free",
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });
});

describe("the admin list", () => {
  it("includes clips nobody has published yet", async () => {
    const harness = renderHookWithProviders(() => useAdminDiscoverVideos(), {
      persona: "admin",
      seed: seedVideos([
        aDiscoverVideo({ id: videoId(0), title: "Live", published: true }),
        aDiscoverVideo({ id: videoId(1), title: "Draft", published: false }),
      ]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    // The queue an admin works from is precisely the clips learners cannot see.
    expect(harness.result.current.data?.map((video) => video.title).sort()).toEqual([
      "Draft",
      "Live",
    ]);
  });

  it("removes a clip", async () => {
    const harness = renderHookWithProviders(
      () => ({ list: useAdminDiscoverVideos(), remove: useDeleteDiscoverVideo() }),
      { persona: "admin", seed: seedVideos([aDiscoverVideo({ id: videoId(0) })]) },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.list.isSuccess).toBe(true));

    await harness.result.current.remove.mutateAsync(videoId(0));

    await waitFor(() => expect(harness.result.current.list.data).toEqual([]));
  });

  it("publishes and unpublishes", async () => {
    const harness = renderHookWithProviders(
      () => ({ list: useAdminDiscoverVideos(), toggle: useTogglePublish() }),
      {
        persona: "admin",
        seed: seedVideos([aDiscoverVideo({ id: videoId(0), published: false })]),
      },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.list.isSuccess).toBe(true));

    await harness.result.current.toggle.mutateAsync({ id: videoId(0), published: true });

    // The single editorial act on this screen: nothing else moves a clip from
    // the queue into the library.
    expect(
      harness.backend.db.lastWriteTo("discover_videos")?.payload[0],
    ).toMatchObject({ published: true });
    await waitFor(() =>
      expect(harness.result.current.list.data?.[0].published).toBe(true),
    );
  });

  it("reports a rejected delete", async () => {
    const harness = renderHookWithProviders(() => useDeleteDiscoverVideo(), {
      persona: "admin",
      seed: (backend) => {
        backend.db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0) })]);
        backend.db.failWrites("discover_videos", 403, { message: "denied" });
      },
    });
    cleanup = harness.cleanup;

    await expect(harness.result.current.mutateAsync(videoId(0))).rejects.toBeTruthy();
  });

  it("reports a rejected publish", async () => {
    const harness = renderHookWithProviders(() => useTogglePublish(), {
      persona: "admin",
      seed: (backend) => {
        backend.db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0) })]);
        backend.db.failWrites("discover_videos", 403, { message: "denied" });
      },
    });
    cleanup = harness.cleanup;

    // A publish that silently failed would leave the clip on the queue and the
    // admin believing it was live.
    await expect(
      harness.result.current.mutateAsync({ id: videoId(0), published: true }),
    ).rejects.toBeTruthy();
  });
});
