import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LetterProgressRow } from "@/hooks/useAlphabetProgress";
import { DailyLetterGoalRing } from "./DailyLetterGoalRing";

/**
 * Today's letter goal, as a ring.
 *
 * The alphabet trainer is a 28-letter climb, and the thing that gets a learner
 * back tomorrow is a target small enough to finish today. Three letters is the
 * default. The count is derived rather than stored: it re-reads the progress
 * rows and counts the ones mastered since midnight, so it resets by itself
 * without a job or a stored date to go stale.
 */

const alphabet = vi.hoisted(() => ({
  progress: {} as Record<string, LetterProgressRow>,
}));
vi.mock("@/hooks/useAlphabetProgress", () => ({
  useAlphabetProgress: () => ({
    progress: alphabet.progress,
    isLoading: false,
    masteredCount: 0,
    isUnlocked: () => true,
    completeStep: vi.fn(),
  }),
}));

const NOW = new Date("2026-03-10T14:00:00");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  alphabet.progress = {};
});

afterEach(() => {
  vi.useRealTimers();
});

const aRow = (masteredAt: string | null): LetterProgressRow => ({
  letter_code: "alif",
  steps_completed: [],
  best_spot_score: 0,
  best_sound_score: 0,
  mastered_at: masteredAt,
  last_practiced_at: NOW.toISOString(),
});

/** `n` letters mastered at the given local time today. */
const masteredToday = (n: number, at = "10:00:00") => {
  alphabet.progress = Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `letter-${i}`,
      aRow(new Date(`2026-03-10T${at}`).toISOString()),
    ]),
  );
};

const sweep = (container: HTMLElement) =>
  container.querySelectorAll("circle")[1] as SVGCircleElement;

describe("DailyLetterGoalRing — counting today's letters", () => {
  it("starts at zero for a learner who has not begun", () => {
    render(<DailyLetterGoalRing />);
    expect(screen.getByText("0/3")).toBeInTheDocument();
  });

  it("counts a letter mastered this morning", () => {
    masteredToday(1);
    render(<DailyLetterGoalRing />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("ignores letters mastered before midnight", () => {
    // The goal is daily; yesterday's work must not carry over or the ring
    // would be permanently complete after a good week.
    alphabet.progress = {
      a: aRow(new Date("2026-03-09T23:59:00").toISOString()),
      b: aRow(new Date("2026-03-10T00:01:00").toISOString()),
    };
    render(<DailyLetterGoalRing />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("counts one mastered at midnight exactly", () => {
    alphabet.progress = { a: aRow(new Date("2026-03-10T00:00:00").toISOString()) };
    render(<DailyLetterGoalRing />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("ignores letters that were practised but never mastered", () => {
    alphabet.progress = { a: aRow(null), b: aRow(null) };
    render(<DailyLetterGoalRing />);
    expect(screen.getByText("0/3")).toBeInTheDocument();
  });
});

describe("DailyLetterGoalRing — before the goal is met", () => {
  it("says how many are left", () => {
    masteredToday(1);
    render(<DailyLetterGoalRing />);
    expect(screen.getByText("2 to go")).toBeInTheDocument();
  });

  it("names what the ring is about", () => {
    render(<DailyLetterGoalRing />);
    expect(screen.getByText("Daily letters")).toBeInTheDocument();
  });

  it("spells the count out on hover", () => {
    masteredToday(2);
    const { container } = render(<DailyLetterGoalRing />);
    expect(container.firstChild).toHaveAttribute(
      "title",
      "2 of 3 letters mastered today",
    );
  });

  it("fills the ring in proportion", () => {
    masteredToday(1);
    const { container } = render(<DailyLetterGoalRing />);
    const [dash] = sweep(container).getAttribute("stroke-dasharray")!.split(" ").map(Number);
    const circumference = 2 * Math.PI * ((56 - 5) / 2);
    expect(dash).toBeCloseTo(circumference / 3, 5);
  });

  it("leaves the ring empty at zero", () => {
    const { container } = render(<DailyLetterGoalRing />);
    const [dash] = sweep(container).getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBe(0);
  });
});

describe("DailyLetterGoalRing — once the goal is met", () => {
  it("celebrates", () => {
    masteredToday(3);
    render(<DailyLetterGoalRing />);
    expect(screen.getByText("Goal hit!")).toBeInTheDocument();
  });

  it("offers a stretch rather than stopping", () => {
    masteredToday(3);
    render(<DailyLetterGoalRing />);
    expect(screen.getByText("Stretch goal: +1?")).toBeInTheDocument();
  });

  it("swaps the count for a flame", () => {
    masteredToday(3);
    render(<DailyLetterGoalRing />);
    expect(screen.queryByText("3/3")).not.toBeInTheDocument();
  });

  it("turns the border amber", () => {
    masteredToday(3);
    const { container } = render(<DailyLetterGoalRing />);
    expect((container.firstChild as HTMLElement).className).toContain("border-amber-500/60");
  });

  it("stays complete when the goal is beaten", () => {
    // Overshooting is the point of the stretch line; the ring must not wrap.
    masteredToday(7);
    const { container } = render(<DailyLetterGoalRing />);
    expect(screen.getByText("Goal hit!")).toBeInTheDocument();
    const [dash, rest] = sweep(container).getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(rest).toBeCloseTo(0, 5);
    expect(dash).toBeGreaterThan(0);
  });
});

describe("DailyLetterGoalRing — a caller's own goal", () => {
  it("counts against it", () => {
    masteredToday(2);
    render(<DailyLetterGoalRing goal={5} />);
    expect(screen.getByText("2/5")).toBeInTheDocument();
    expect(screen.getByText("3 to go")).toBeInTheDocument();
  });

  it("treats a goal of zero as already met without dividing by it", () => {
    render(<DailyLetterGoalRing goal={0} />);
    expect(screen.getByText("Goal hit!")).toBeInTheDocument();
  });
});
