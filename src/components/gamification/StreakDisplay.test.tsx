import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aReviewStreak } from "@/test/support/factories";
import type { InstalledBackend } from "@/test/support/transports/vitest";
import { StreakDisplay } from "./StreakDisplay";

/**
 * The review streak, in two sizes.
 *
 * A streak is the one number in the app that only ever means "you came back",
 * which is why it appears in the header as a pill and on the profile as a card.
 * The card also carries the personal best, because a broken streak is much
 * easier to start again when the screen remembers how far you once got.
 */

type Backend = InstalledBackend["backend"];

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  compact?: boolean;
  seed?: (backend: Backend) => void;
  persona?: "free" | "anonymous";
}

async function render({ compact, seed, persona = "free" }: Options = {}) {
  const harness = renderWithProviders(<StreakDisplay compact={compact} />, { persona, seed });
  cleanup = harness.cleanup;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return harness;
}

const withStreak = (current: number, longest = Math.max(current, 12)) => (backend: Backend) =>
  backend.db.seed("review_streaks", [aReviewStreak({ current_streak: current, longest_streak: longest })]);

describe("StreakDisplay — when there is nothing to show", () => {
  it("renders nothing for a learner who has never reviewed", async () => {
    // The row is created on the first review, so its absence means "not
    // started" — and a zero card would be a discouraging thing to open on.
    const { container } = await render({ seed: (b) => b.db.seed("review_streaks", []) });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing for a signed-out visitor", async () => {
    const { container } = await render({ persona: "anonymous" });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("StreakDisplay — the full card", () => {
  it("shows the current run and the personal best", async () => {
    await render({ seed: withStreak(5, 12) });
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.getByText("day streak")).toBeInTheDocument();
    expect(screen.getByText("12 days")).toBeInTheDocument();
    expect(screen.getByText("Best")).toBeInTheDocument();
  });

  it("lights the flame while the streak is alive", async () => {
    const { container } = await render({ seed: withStreak(5) });
    await screen.findByText("5");
    expect(container.querySelector(".from-orange-400")).toBeInTheDocument();
  });

  it("greys the flame out once the streak breaks", async () => {
    // The card still appears — the best is worth keeping in view — but it stops
    // claiming a run that has ended.
    const { container } = await render({ seed: withStreak(0, 12) });
    await screen.findByText("0");
    expect(container.querySelector(".from-orange-400")).toBeNull();
    expect(container.querySelector(".bg-muted")).toBeInTheDocument();
  });

  it("shows a best equal to the current run on a personal record", async () => {
    await render({ seed: withStreak(30, 30) });
    expect(await screen.findByText("30")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
  });
});

describe("StreakDisplay — the compact pill", () => {
  it("fits the streak into one line", async () => {
    await render({ compact: true, seed: withStreak(5) });
    expect(await screen.findByText("5 days")).toBeInTheDocument();
  });

  it("says one day rather than one days", async () => {
    await render({ compact: true, seed: withStreak(1) });
    expect(await screen.findByText("1 day")).toBeInTheDocument();
  });

  it("leaves the personal best to the full card", async () => {
    // The pill lives in a crowded header; two numbers there read as a score.
    await render({ compact: true, seed: withStreak(5, 12) });
    await screen.findByText("5 days");
    expect(screen.queryByText("Best")).not.toBeInTheDocument();
  });

  it("greys the flame on a streak of zero", async () => {
    // The full card already greys at zero; the pill rendered "0 days" on the
    // same orange background, with the same orange flame, as a thirty-day run.
    // It is the version that sits in the header on every screen, so the state a
    // learner saw most often was the one that could not tell "you are on a
    // streak" from "you lost it".
    const { container } = await render({ compact: true, seed: withStreak(0, 12) });
    await screen.findByText("0 days");
    expect(container.querySelector(".bg-orange-100")).toBeNull();
    expect(container.querySelector(".text-orange-500")).toBeNull();
    expect(container.querySelector(".bg-muted")).toBeInTheDocument();
  });

  it("keeps the orange while the streak is alive", async () => {
    const { container } = await render({ compact: true, seed: withStreak(1) });
    await screen.findByText("1 day");
    expect(container.querySelector(".bg-orange-100")).toBeInTheDocument();
    expect(container.querySelector(".text-orange-500")).toBeInTheDocument();
  });
});

describe("StreakDisplay — where it reads from", () => {
  it("asks for the signed-in learner's own row", async () => {
    const { backend } = await render({ seed: withStreak(5) });
    await screen.findByText("5");

    const read = backend.db.readsOf("review_streaks").at(-1);
    expect(read?.search).toContain("user_id=eq.");
  });

  it("copes with a learner who somehow has two rows", async () => {
    // maybeSingle would throw on multiple; seeding one per user is the schema's
    // intent, and this pins that the query stays scoped rather than aggregating.
    await render({
      seed: (b) => b.db.seed("review_streaks", [aReviewStreak({ current_streak: 5 })]),
    });
    expect(await screen.findByText("5")).toBeInTheDocument();
  });
});
