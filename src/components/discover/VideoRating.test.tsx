import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { TEST_USER_ID, videoId as makeVideoId } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { VideoRating } from "./VideoRating";

/**
 * Five stars under a Discover video.
 *
 * The feed is curated by hand and there is no other signal about whether a clip
 * actually taught anyone anything — a view count says the thumbnail worked, not
 * that the video was any good. This is the only feedback loop the curation has.
 *
 * The stars are optimistic on purpose: the rating fills in the moment it is
 * tapped and is rolled back if the write fails, because a star that waits for a
 * round trip feels broken on a phone.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success(...a),
    error: (...a: unknown[]) => toasts.error(...a),
  },
}));

const VIDEO = makeVideoId(0);

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
});

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  /** A default parameter cannot express "pass undefined", so this is a flag. */
  signedOut?: boolean;
  existing?: number | null;
  seed?: (backend: SupabaseBackend) => void;
}

function render({ signedOut = false, existing = null, seed }: Options = {}) {
  const harness = renderWithProviders(
    <VideoRating
      videoId={VIDEO}
      userId={signedOut ? undefined : TEST_USER_ID}
    />,
    {
      persona: "free",
      seed: (backend) => {
        if (existing !== null) {
          backend.db.seed("video_ratings", [
            { video_id: VIDEO, user_id: TEST_USER_ID, rating: existing },
          ]);
        }
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

const star = (n: number) =>
  screen.getByRole("button", { name: `Rate ${n} out of 5` });
const stars = () => screen.getAllByRole("button");
const filled = () =>
  stars().filter((b) => b.querySelector(".fill-primary") !== null).length;

const ratings = (backend: SupabaseBackend) =>
  backend.db.writesTo("video_ratings").flatMap((w) => w.payload);

describe("before anything is rated", () => {
  it("asks for a rating", () => {
    render();

    expect(screen.getByText("Rate this video")).toBeInTheDocument();
    expect(stars()).toHaveLength(5);
  });

  it("shows five empty stars", () => {
    render();

    expect(filled()).toBe(0);
    // No label either: a description with nothing selected would be describing
    // a rating the learner has not given.
    expect(screen.queryByText("Good")).toBeNull();
  });

  it("names each star for a screen reader", () => {
    render();

    // Five identical star glyphs are five identical buttons without this.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(star(n)).toBeInTheDocument();
    }
  });
});

describe("a rating already given", () => {
  it("loads and shows it", async () => {
    render({ existing: 4 });

    await waitFor(() => expect(filled()).toBe(4));
    expect(screen.getByText("Your rating")).toBeInTheDocument();
    expect(screen.getByText("Great")).toBeInTheDocument();
  });

  it("looks it up for this learner and this video only", async () => {
    const { backend } = render({ existing: 4 });

    await waitFor(() =>
      expect(backend.db.readsOf("video_ratings").length).toBeGreaterThan(0),
    );
    const search = backend.db.readsOf("video_ratings")[0].search;
    expect(search).toContain(`video_id=eq.${VIDEO}`);
    expect(search).toContain(`user_id=eq.${TEST_USER_ID}`);
  });

  it("does not go looking when nobody is signed in", () => {
    const { backend } = render({ signedOut: true });

    // Discover is browsable signed out. A query with no user filter would read
    // somebody else's rating.
    expect(backend.db.readsOf("video_ratings")).toHaveLength(0);
    expect(screen.getByText("Rate this video")).toBeInTheDocument();
  });
});

describe("hovering", () => {
  it("previews the rating under the pointer", () => {
    render();

    fireEvent.mouseEnter(star(3));

    // The label is what makes the scale mean anything — three stars is "Good",
    // not just three of five.
    expect(filled()).toBe(3);
    expect(screen.getByText("Good")).toBeInTheDocument();
  });

  it("previews over a rating already given", async () => {
    render({ existing: 2 });
    await waitFor(() => expect(filled()).toBe(2));

    fireEvent.mouseEnter(star(5));

    expect(filled()).toBe(5);
    expect(screen.getByText("Love it — more like this!")).toBeInTheDocument();
  });

  it("goes back to the real rating when the pointer leaves", async () => {
    const { container } = render({ existing: 2 });
    await waitFor(() => expect(filled()).toBe(2));
    fireEvent.mouseEnter(star(5));

    fireEvent.mouseLeave(container.querySelector(".flex.gap-1")!);

    // Leaving a hover preview stuck at five would misreport what the learner
    // actually said.
    expect(filled()).toBe(2);
    expect(screen.getByText("Somewhat useful")).toBeInTheDocument();
  });
});

describe("rating a video", () => {
  it("fills the stars straight away", async () => {
    render();

    await act(async () => {
      fireEvent.click(star(4));
    });

    // Optimistic, because on a phone a star that waits for the network reads as
    // a tap that missed.
    expect(filled()).toBe(4);
  });

  it("records the rating against the learner and the video", async () => {
    const { backend } = render();

    await act(async () => {
      fireEvent.click(star(4));
    });

    await waitFor(() => expect(ratings(backend)).toHaveLength(1));
    expect(ratings(backend)[0]).toMatchObject({
      video_id: VIDEO,
      user_id: TEST_USER_ID,
      rating: 4,
    });
  });

  it("says in words what the rating meant", async () => {
    render();

    await act(async () => {
      fireEvent.click(star(5));
    });

    // "Love it — more like this!" tells the learner their tap will change the
    // feed, which is the only reason to bother rating anything.
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Love it — more like this!"),
    );
  });

  it.each([
    [1, "Not useful"],
    [2, "Somewhat useful"],
    [3, "Good"],
    [4, "Great"],
    [5, "Love it — more like this!"],
  ])("describes %i stars as %s", async (value, label) => {
    render();

    await act(async () => {
      fireEvent.click(star(value));
    });

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(label));
  });

  it("changes an earlier rating rather than adding a second", async () => {
    const { backend } = render({ existing: 2 });
    await waitFor(() => expect(filled()).toBe(2));

    await act(async () => {
      fireEvent.click(star(5));
    });

    // Upserted on (video_id, user_id): a learner who revises their opinion has
    // one rating, not two.
    await waitFor(() => expect(ratings(backend)).toHaveLength(1));
    expect(ratings(backend)[0]).toMatchObject({ rating: 5 });
  });

  it("stamps when the rating was last changed", async () => {
    const { backend } = render();

    await act(async () => {
      fireEvent.click(star(3));
    });

    // The upsert overwrites the row, so without this the timestamp would say
    // when the learner first rated it rather than when they last did.
    await waitFor(() => expect(ratings(backend)).toHaveLength(1));
    expect(ratings(backend)[0]).toHaveProperty("updated_at");
  });

  it("takes the stars back when the write failed", async () => {
    render({ seed: (b) => b.db.failInserts("video_ratings") });

    await act(async () => {
      fireEvent.click(star(4));
    });

    // Leaving them filled would tell the learner their rating counted when it
    // did not.
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("Failed to save rating"),
    );
    expect(filled()).toBe(0);
    expect(screen.getByText("Rate this video")).toBeInTheDocument();
  });

  it("can be rated again after a failure", async () => {
    render({ seed: (b) => b.db.failInserts("video_ratings") });

    await act(async () => {
      fireEvent.click(star(4));
    });

    await waitFor(() => expect(star(4)).toBeEnabled());
  });
});

describe("when nobody is signed in", () => {
  it("says why the tap did nothing", async () => {
    const { backend } = render({ signedOut: true });

    await act(async () => {
      fireEvent.click(star(4));
    });

    expect(toasts.error).toHaveBeenCalledWith("Please log in to rate videos");
    expect(ratings(backend)).toHaveLength(0);
  });

  it("leaves the stars empty", async () => {
    render({ signedOut: true });

    await act(async () => {
      fireEvent.click(star(4));
    });

    // The optimistic fill happens after the signed-out check, so the stars must
    // not move.
    expect(filled()).toBe(0);
  });
});
