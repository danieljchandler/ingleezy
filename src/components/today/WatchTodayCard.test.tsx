import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aDiscoverVideo, aProfile, videoId } from "@/test/support/factories";
import { getCompletedToday } from "@/lib/todayCompletion";
import { WatchTodayCard } from "./WatchTodayCard";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The home page's lead card.
 *
 * Watching native video is the app's core loop, and this card is how a learner
 * gets into it — one clip, already chosen, above everything else on the page.
 * The two things that break it are silent: a card that renders empty when the
 * library has something in it, and an opened clip that never marks the day's
 * task done, so the queue keeps nagging about a video already watched.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const seedLibrary =
  (rows: Record<string, unknown>[]) =>
  (backend: SupabaseBackend) => {
    backend.db.seed("profiles", [aProfile()]);
    backend.db.seed("discover_videos", rows);
  };

function renderCard(rows: Record<string, unknown>[], props = {}) {
  const harness = renderWithProviders(<WatchTodayCard {...props} />, {
    persona: "free",
    seed: seedLibrary(rows),
  });
  cleanup = harness.cleanup;
  return harness;
}

describe("today's video card", () => {
  it("names the thing it wants the learner to do", async () => {
    renderCard([aDiscoverVideo({ id: videoId(0), title: "Ordering coffee in Doha" })]);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Watch today's video/ })).toBeInTheDocument(),
    );
  });

  it("shows the clip itself, not a link to a list of clips", async () => {
    renderCard([aDiscoverVideo({ id: videoId(0), title: "Ordering coffee in Doha" })]);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Watch video: Ordering coffee in Doha/ }),
      ).toBeInTheDocument(),
    );
  });

  it("marks the day's video task done when the clip is opened", async () => {
    renderCard([aDiscoverVideo({ id: videoId(0), title: "Ordering coffee in Doha" })]);
    const card = await screen.findByRole("button", { name: /^Watch video:/ });

    fireEvent.click(card);

    // The video page has no completion event of its own, so opening the clip is
    // the only signal there is — without it the queue nags about a video the
    // learner has already watched.
    expect(getCompletedToday()).toContain("listening");
  });

  it("says so when the clip comes from another dialect", async () => {
    renderCard([aDiscoverVideo({ id: videoId(0), dialect: "Egyptian" })]);

    // Falling back beats an empty card, but a Gulf learner should know why the
    // badge says Egyptian.
    await waitFor(() => expect(screen.getByText(/Egyptian clip/)).toBeInTheDocument());
  });

  it("renders nothing at all when the library is empty", async () => {
    const { container } = renderCard([]);

    // Not an empty frame at the top of the home page: with nothing to watch the
    // card has to take up no room at all.
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the day's video as watched once it is done", async () => {
    renderCard([aDiscoverVideo({ id: videoId(0) })], { done: true });

    await waitFor(() => expect(screen.getByText("Watched")).toBeInTheDocument());
  });
});
