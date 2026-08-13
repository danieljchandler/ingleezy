import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { markTourPending, OnboardingTour } from "./OnboardingTour";

/**
 * The five-step walkthrough of the bottom navigation.
 *
 * The app's whole surface hangs off five tabs, and a learner who never finds
 * Discover or Practice sees a fraction of what they signed up for. So this runs
 * exactly once, immediately after onboarding, and highlights each tab in turn
 * against a dimmed page.
 *
 * Two things make it delicate. It is armed by one flag and disarmed by another,
 * and getting that wrong means either never showing it or showing it on every
 * visit forever. And it measures a live DOM element to cut the hole in the
 * overlay — so it has to survive the target not being there, which is the
 * ordinary case on a page without the nav.
 */

const TOUR_KEY = "ingleezy:tourCompleted";
const TRIGGER_KEY = "ingleezy:showTour";

const STEP_TITLES = ["Today", "Learn", "Discover", "Practice", "Me"];

let cleanup: (() => void) | undefined;
let nav: HTMLElement | undefined;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
});

afterEach(async () => {
  // The providers the harness wraps around the tour resolve a session in the
  // background. Restoring the real fetch before that lands turns it into an
  // unstubbed network request, which the suite treats as a failure of hermeticity.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
  nav?.remove();
  nav = undefined;
  localStorage.clear();
  vi.useRealTimers();
});

/** Stands in for the bottom navigation the tour points at. */
function mountNav() {
  nav = document.createElement("div");
  for (const tab of ["today", "learn", "discover", "practice", "me"]) {
    const el = document.createElement("button");
    el.setAttribute("data-tour", `nav-${tab}`);
    el.textContent = tab;
    nav.appendChild(el);
  }
  document.body.appendChild(nav);
}

interface Options {
  pending?: boolean;
  completed?: boolean;
  withNav?: boolean;
}

/** Renders and advances past the 400ms the tour waits for the nav to mount. */
function render({ pending = true, completed = false, withNav = true }: Options = {}) {
  if (pending) localStorage.setItem(TRIGGER_KEY, "1");
  if (completed) localStorage.setItem(TOUR_KEY, "1");
  if (withNav) mountNav();

  const harness = renderWithProviders(<OnboardingTour />, { persona: "free" });
  cleanup = harness.cleanup;
  return harness;
}

const openTour = () => act(() => void vi.advanceTimersByTime(400));

const tour = () => screen.queryByRole("dialog");
const next = () => fireEvent.click(screen.getByRole("button", { name: /^(Next|Done)$/ }));
const dots = () => Array.from(document.querySelectorAll(".rounded-full.h-1\\.5"));

describe("deciding whether to run", () => {
  it("stays out of the way until something asks for it", () => {
    render({ pending: false });

    openTour();

    // The flag is set by onboarding. Running unasked would put a modal over the
    // app for every existing learner on their next visit.
    expect(tour()).toBeNull();
  });

  it("does not run a second time", () => {
    render({ completed: true });

    openTour();

    // Both flags are set here — completed wins, which is what makes the tour a
    // one-off rather than something the trigger can resurrect.
    expect(tour()).toBeNull();
  });

  it("waits for the navigation to mount before pointing at it", () => {
    render();

    // Measuring a nav that has not rendered yet puts the cutout at the origin,
    // so the tour deliberately arrives late.
    expect(tour()).toBeNull();
    openTour();
    expect(tour()).not.toBeNull();
  });

  it("can be armed for the next visit", () => {
    markTourPending();

    expect(localStorage.getItem(TRIGGER_KEY)).toBe("1");
  });
});

describe("walking through the tabs", () => {
  it("starts on Today and says where it is", () => {
    render();

    openTour();

    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByText(/Your daily home/)).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
  });

  it("advances through every tab in nav order", () => {
    render();
    openTour();

    for (const [index, title] of STEP_TITLES.entries()) {
      // Reading in the same order as the tabs on screen is the point — a tour
      // that jumps around teaches the learner nothing about where things are.
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByText(`Step ${index + 1} of 5`)).toBeInTheDocument();
      if (index < STEP_TITLES.length - 1) next();
    }
  });

  it("marks progress on the dots", () => {
    render();
    openTour();

    expect(dots()).toHaveLength(5);
    expect(dots()[0].className).toContain("w-5");
    next();

    expect(dots()[0].className).toContain("w-1.5");
    expect(dots()[1].className).toContain("w-5");
  });

  it("offers Done rather than Next on the last tab", () => {
    render();
    openTour();
    for (let i = 0; i < 4; i++) next();

    // "Next" on the final step promises a sixth step that does not exist.
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("closes for good once the last tab is acknowledged", () => {
    render();
    openTour();
    for (let i = 0; i < 4; i++) next();

    next();

    expect(tour()).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe("1");
    // The trigger has to be cleared too, or the next mount re-arms against a
    // completed flag and the tour is decided by which check runs first.
    expect(localStorage.getItem(TRIGGER_KEY)).toBeNull();
  });
});

describe("leaving early", () => {
  it("can be skipped from the button", () => {
    render();
    openTour();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    // Skipping counts as done: someone who dismissed it once should not be shown
    // it again on their next visit.
    expect(tour()).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe("1");
    expect(localStorage.getItem(TRIGGER_KEY)).toBeNull();
  });

  it("can be closed from the corner", () => {
    render();
    openTour();
    next();

    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));

    // Same outcome from the middle of the tour as from the start.
    expect(tour()).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe("1");
  });
});

describe("highlighting the target", () => {
  it("cuts a hole over the tab it is describing", () => {
    render();
    openTour();

    // The dim is drawn as an enormous shadow around the highlight rather than a
    // backdrop with a hole, so the highlight box is what proves it landed on a
    // target at all.
    const highlight = document.querySelector<HTMLElement>("[style*='box-shadow']")!;
    expect(highlight.style.boxShadow).toContain("9999px");
    expect(document.querySelector(".bg-black\\/65")).toBeNull();
  });

  it("dims the whole page when the tab is not on screen", () => {
    render({ withNav: false });

    openTour();

    // The tour is mounted app-wide and the nav is hidden on some routes. Falling
    // back to a plain dim keeps the copy readable instead of highlighting the
    // top-left corner of the page.
    expect(tour()).not.toBeNull();
    expect(document.querySelector(".bg-black\\/65")).not.toBeNull();
    expect(document.querySelector("[style*='box-shadow']")).toBeNull();
  });

  it("still walks through all five steps with nothing to point at", () => {
    render({ withNav: false });
    openTour();

    for (let i = 0; i < 4; i++) next();

    // The text is the useful half; losing the whole tour because one nav is
    // hidden would be worse than losing the highlight.
    expect(screen.getByRole("heading", { name: "Me" })).toBeInTheDocument();
  });

  it("follows the page when it moves under the cutout", () => {
    const listen = vi.spyOn(window, "addEventListener");
    render();

    openTour();

    // A cutout that stays put while the page scrolls points at the wrong thing,
    // which is worse than not highlighting at all. jsdom gives every element a
    // zero-sized rect, so the listeners are the observable part — scroll in the
    // capture phase, because the nav's own scroll container never bubbles.
    expect(listen).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    listen.mockRestore();
  });

  it("stops listening once it is done", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    render();
    openTour();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    // Scroll is listened for in the capture phase across the whole document; a
    // leak here fires on every scroll for the rest of the session.
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    remove.mockRestore();
  });
});

describe("the overlay itself", () => {
  it("renders outside the app's own tree", () => {
    const { container } = render();

    openTour();

    // Portalled to the body: nested inside the page it would be clipped by the
    // first ancestor with overflow hidden, which on this app is most of them.
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.body.querySelector("[role='dialog']")).not.toBeNull();
  });

  it("announces itself as a modal", () => {
    render();

    openTour();

    expect(tour()).toHaveAttribute("aria-modal", "true");
  });
});
