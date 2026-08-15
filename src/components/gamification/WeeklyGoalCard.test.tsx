import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyGoalCard } from "./WeeklyGoalCard";

/**
 * The weekly target card.
 *
 * Two goals, reviews and XP, each a count against a target with a bar. The
 * interesting part is arithmetic rather than layout: the percentages drive the
 * bars, and the "complete" state changes the colour, adds a tick and unlocks a
 * congratulation — so an off-by-one here is the difference between a learner
 * being told they finished their week and being told they did not.
 *
 * useWeeklyGoal is stood in for; it has its own tests, and pinning the clock to
 * a Monday just to reach this card's maths would obscure it.
 */

interface Goal {
  completed_reviews: number;
  target_reviews: number;
  earned_xp: number;
  target_xp: number;
}

const goal = vi.hoisted(() => ({
  data: null as Goal | null,
  isLoading: false,
}));
vi.mock("@/hooks/useGamification", () => ({
  useWeeklyGoal: () => ({ data: goal.data, isLoading: goal.isLoading }),
}));

beforeEach(() => {
  goal.isLoading = false;
  goal.data = { completed_reviews: 20, target_reviews: 50, earned_xp: 120, target_xp: 300 };
});

function renderCard(over: Partial<Goal> = {}) {
  if (goal.data) goal.data = { ...goal.data, ...over };
  return render(<WeeklyGoalCard />);
}

/**
 * How full each bar is, reviews first.
 *
 * Radix leaves `aria-valuenow` off the root, so the only place the number
 * survives to the DOM is the indicator's transform: a 40% bar is shifted 60%
 * to the left.
 */
const bars = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[role='progressbar'] > div")].map((el) => {
    const shift = /translateX\(-(.+)%\)/.exec(el.style.transform)?.[1];
    return shift === undefined ? null : 100 - Number(shift);
  });

describe("WeeklyGoalCard — when there is nothing to show", () => {
  it("renders nothing while the goal is loading", () => {
    goal.isLoading = true;
    const { container } = render(<WeeklyGoalCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the learner has no goal this week", () => {
    // A goal row is created lazily on the first review of the week, so a
    // learner who has not started yet has none — and an empty card would be a
    // worse first impression than no card.
    goal.data = null;
    const { container } = render(<WeeklyGoalCard />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("WeeklyGoalCard — the two goals", () => {
  it("names itself", () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "أهداف الأسبوع" })).toBeInTheDocument();
  });

  it("shows both counts against their targets", () => {
    renderCard();
    expect(screen.getByText("20/50")).toBeInTheDocument();
    expect(screen.getByText("120/300")).toBeInTheDocument();
  });

  it("labels which is which", () => {
    renderCard();
    expect(screen.getByText("مراجعات")).toBeInTheDocument();
    expect(screen.getByText("نقاط مكتسبة")).toBeInTheDocument();
  });

  it("fills each bar to its own percentage", () => {
    const { container } = renderCard();
    expect(bars(container)).toEqual([40, 40]);
  });

  it("rounds a fractional percentage", () => {
    const { container } = renderCard({ completed_reviews: 1, target_reviews: 3 });
    expect(bars(container)[0]).toBe(33);
  });

  it("shows an empty bar at the start of the week", () => {
    const { container } = renderCard({ completed_reviews: 0, earned_xp: 0 });
    expect(bars(container)).toEqual([0, 0]);
  });
});

describe("WeeklyGoalCard — finishing a goal", () => {
  it("ticks the reviews goal when the target is met", () => {
    renderCard({ completed_reviews: 50 });
    expect(screen.getByText(/^50\/50/)).toHaveTextContent("50/50 ✓");
  });

  it("counts exactly the target as met", () => {
    renderCard({ earned_xp: 300 });
    expect(screen.getByText(/^300\/300/)).toHaveTextContent("300/300 ✓");
  });

  it("does not tick one short", () => {
    renderCard({ completed_reviews: 49 });
    expect(screen.getByText("49/50")).not.toHaveTextContent("✓");
  });

  it("turns the finished count green", () => {
    renderCard({ completed_reviews: 50 });
    expect(screen.getByText(/^50\/50/).className).toContain("text-green-600");
  });

  it("leaves an unfinished count in the default colour", () => {
    renderCard();
    expect(screen.getByText("20/50").className).not.toContain("text-green-600");
  });

  it("caps an overshot bar at full", () => {
    // Overshooting is normal — a long session blows past the target — and a bar
    // rendering past 100 would run out of its track.
    const { container } = renderCard({ completed_reviews: 500, earned_xp: 9999 });
    expect(bars(container)).toEqual([100, 100]);
  });

  it("still shows the true count when overshot", () => {
    renderCard({ completed_reviews: 500 });
    expect(screen.getByText(/^500\/50/)).toBeInTheDocument();
  });

  it("celebrates only when both goals are done", () => {
    renderCard({ completed_reviews: 50, earned_xp: 300 });
    expect(screen.getByText("🎉 Weekly goals complete!")).toBeInTheDocument();
  });

  it("stays quiet when only the reviews are done", () => {
    renderCard({ completed_reviews: 50 });
    expect(screen.queryByText("🎉 Weekly goals complete!")).not.toBeInTheDocument();
  });

  it("stays quiet when only the XP is done", () => {
    renderCard({ earned_xp: 300 });
    expect(screen.queryByText("🎉 Weekly goals complete!")).not.toBeInTheDocument();
  });

  it("does not congratulate a learner on a target of zero", () => {
    // 0/0 made the percentage NaN, while the separate completion check —
    // `0 >= 0` — was true. The card ticked the goal, turned it green and fired
    // the confetti line for a week in which nothing was done, above a bar the
    // Progress wrapper's `value || 0` had quietly emptied: the two halves of
    // the card contradicted each other.
    const { container } = renderCard({
      completed_reviews: 0,
      target_reviews: 0,
      earned_xp: 0,
      target_xp: 0,
    });
    expect(screen.queryByText("🎉 Weekly goals complete!")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^0\/0/)[0]).not.toHaveTextContent("✓");
    expect(bars(container)).toEqual([0, 0]);
  });

  it("leaves a real goal that happens to be met still complete", () => {
    renderCard({
      completed_reviews: 50,
      target_reviews: 50,
      earned_xp: 300,
      target_xp: 300,
    });
    expect(screen.getByText("🎉 Weekly goals complete!")).toBeInTheDocument();
  });

  it("holds one half back when only that half has no target", () => {
    // A zero target on one goal must not drag the other's progress with it.
    const { container } = renderCard({
      completed_reviews: 25,
      target_reviews: 50,
      earned_xp: 0,
      target_xp: 0,
    });
    expect(bars(container)).toEqual([50, 0]);
    expect(screen.queryByText("🎉 Weekly goals complete!")).not.toBeInTheDocument();
  });
});
