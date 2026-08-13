import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aDiscoverVideo, aProfile, videoId } from "@/test/support/factories";
import { useTodaysVideo } from "./useTodaysVideo";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The clip the home page leads with.
 *
 * Video is the reason the app exists, so this pick is the first thing a learner
 * sees. The failure that matters is the quiet one: a filter — dialect, or level
 * — that matches nothing and leaves the top of the home page blank. There is no
 * error state for that, just an app that appears not to have the feature. Every
 * narrowing here therefore falls back rather than returning nothing.
 */

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  // The pick is keyed to the local date; a run straddling midnight would
  // otherwise choose two different clips within one test.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-03-11T12:00:00"));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

const seed =
  (rows: Record<string, unknown>[], profile: Record<string, unknown> = {}) =>
  (backend: SupabaseBackend) => {
    backend.db.seed("profiles", [aProfile(profile)]);
    backend.db.seed("discover_videos", rows);
  };

const render = (rows: Record<string, unknown>[], profile: Record<string, unknown> = {}) => {
  const harness = renderHookWithProviders(() => useTodaysVideo(), {
    persona: "free",
    seed: seed(rows, profile),
  });
  cleanup = harness.cleanup;
  return harness;
};

describe("choosing today's clip", () => {
  it("prefers the learner's own dialect", async () => {
    const harness = render(
      [
        aDiscoverVideo({ id: videoId(0), title: "Cairo clip", dialect: "Egyptian" }),
        aDiscoverVideo({ id: videoId(1), title: "Doha clip", dialect: "Gulf" }),
      ],
      { preferred_dialect: "Gulf" },
    );

    await waitFor(() => expect(harness.result.current.video?.title).toBe("Doha clip"));
    expect(harness.result.current.isFromAnotherDialect).toBe(false);
  });

  it("falls back to another dialect rather than showing nothing", async () => {
    // The card is meant to be there on every dialect. A learner who switches to
    // one we have not filmed much of yet would otherwise open the app to a home
    // page with no video on it and conclude the feature does not exist.
    const harness = render([aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })], {
      preferred_dialect: "Yemeni",
      placement_level_yemeni: "A2",
    });

    await waitFor(() => expect(harness.result.current.video?.dialect).toBe("Gulf"));
    expect(harness.result.current.isFromAnotherDialect).toBe(true);
  });

  it("stays inside the learner's level window when it can", async () => {
    const harness = render(
      [
        aDiscoverVideo({ id: videoId(0), title: "Way too hard", difficulty: "Expert" }),
        aDiscoverVideo({ id: videoId(1), title: "About right", difficulty: "Beginner" }),
      ],
      { placement_level_gulf: "A1" },
    );

    await waitFor(() => expect(harness.result.current.video?.title).toBe("About right"));
  });

  it("matches a difficulty whatever case it was stored in", async () => {
    // Difficulty is hand-written in several places and both "Beginner" and
    // "beginner" are in the table; a case-sensitive match drops half the
    // library on the floor.
    const harness = render([aDiscoverVideo({ id: videoId(0), difficulty: "beginner" })], {
      placement_level_gulf: "A1",
    });

    await waitFor(() => expect(harness.result.current.video?.id).toBe(videoId(0)));
  });

  it("ignores the level window when nothing sits inside it", async () => {
    // Better a clip above the learner's level than an empty home page.
    const harness = render([aDiscoverVideo({ id: videoId(0), difficulty: "Expert" })], {
      placement_level_gulf: "A1",
    });

    await waitFor(() => expect(harness.result.current.video?.id).toBe(videoId(0)));
  });

  it("has nothing to offer only when the library is empty", async () => {
    const harness = render([]);

    await waitFor(() => expect(harness.result.current.isLoading).toBe(false));
    expect(harness.result.current.video).toBeNull();
  });
});

describe("leading with the most recent clip", () => {
  // The pool is ordered newest-first by created_at, so the home page leads with
  // the most recently uploaded and published clip rather than rotating by day.
  const threeClips = [
    aDiscoverVideo({ id: videoId(0), title: "One" }),
    aDiscoverVideo({ id: videoId(1), title: "Two" }),
    aDiscoverVideo({ id: videoId(2), title: "Three" }),
  ];

  it("always leads with the newest clip, all day", async () => {
    const first = render(threeClips);
    await waitFor(() => expect(first.result.current.video).toBeTruthy());
    const morning = first.result.current.video?.id;
    cleanup?.();

    vi.setSystemTime(new Date("2026-03-11T21:30:00"));
    const second = render(threeClips);

    await waitFor(() => expect(second.result.current.video?.id).toBe(morning));
  });

  it("keeps the newest clip the next day too", async () => {
    const first = render(threeClips);
    await waitFor(() => expect(first.result.current.video).toBeTruthy());
    const today = first.result.current.video?.id;
    cleanup?.();

    vi.setSystemTime(new Date("2026-03-12T09:00:00"));
    const second = render(threeClips);

    await waitFor(() => expect(second.result.current.video?.id).toBe(today));
  });
});

describe("when the library cannot be read", () => {
  it("reports no clip instead of hanging on loading", async () => {
    const harness = renderHookWithProviders(() => useTodaysVideo(), {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("profiles", [aProfile()]);
        backend.db.failAlways("discover_videos", 500);
      },
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isLoading).toBe(false));
    expect(harness.result.current.video).toBeNull();
  });
});
