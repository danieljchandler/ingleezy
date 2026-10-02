import { act, fireEvent, screen } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BookOpen, Brain, Flame, Play } from "lucide-react";
import { renderWithProviders } from "@/test/support/react/harness";
import type { TodayTask, TodayTaskId } from "@/hooks/useTodayQueue";
import { PlanCard } from "./PlanCard";

/**
 * The plan card is the first thing on the app's front door, and its button is
 * the first tap of a learner's day. What it must get right: show three steps,
 * send the button to the first unfinished one, never pre-complete a task that
 * has its own completion event, and keep the rest of the queue reachable.
 */

let cleanup: (() => void) | undefined;

afterEach(async () => {
  // The providers resolve a session in the background; let it land before the
  // stubbed fetch is restored, or it escapes as a real network request.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

const task = (id: TodayTaskId, title: string, over: Partial<TodayTask> = {}): TodayTask => ({
  id,
  title,
  subtitle: "subtitle",
  estMinutes: 3,
  icon: Play,
  route: `/${id}`,
  done: false,
  xpEstimate: 10,
  ...over,
});

const DAY = (over: Partial<Record<TodayTaskId, Partial<TodayTask>>> = {}) => [
  task("listening", "شاهد فيديو اليوم", { route: "/discover/clip-1", ...over.listening }),
  task("flashcards", "راجع 3 كلمات", { icon: Brain, route: "/review", countBadge: "3", ...over.flashcards }),
  task("daily-challenge", "تحدي اليوم", { icon: Flame, ...over["daily-challenge"] }),
  task("reading", "اقرأ نصاً قصيراً", { icon: BookOpen, ...over.reading }),
];

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function render(tasks: TodayTask[], videoTitle?: string) {
  const harness = renderWithProviders(
    <>
      <PlanCard tasks={tasks} videoTitle={videoTitle} />
      <Where />
    </>,
    { persona: "free" },
  );
  cleanup = harness.cleanup;
  return harness;
}

const where = () => screen.getByTestId("where").textContent;
const COMPLETIONS_KEY = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `today.completed.${now.getFullYear()}-${month}-${day}`;
};

describe("the plan", () => {
  it("shows three steps, not the whole queue", () => {
    render(DAY());

    expect(screen.getByRole("heading", { name: "خطة اليوم" })).toBeInTheDocument();
    // Step buttons are named "<title> — تقريباً n دقائق"; the main button starts with ابدأ.
    expect(screen.getByRole("button", { name: /^شاهد فيديو اليوم —/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^راجع 3 كلمات —/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^تحدي اليوم —/ })).toBeInTheDocument();
    // The fourth task waits under "if you have time".
    expect(screen.queryByRole("button", { name: /^اقرأ نصاً قصيراً —/ })).toBeNull();
  });

  it("says how far through the day the learner is", () => {
    render(DAY({ listening: { done: true } }));

    expect(screen.getByText("أنجزت 1 من 3 مهام")).toBeInTheDocument();
  });

  it("puts today's clip title under the watch step, left to right", () => {
    render(DAY(), "I'm not gonna lie — that was rough.");

    const subtitle = screen.getByText("I'm not gonna lie — that was rough.");
    expect(subtitle).toHaveAttribute("dir", "ltr");
  });
});

describe("the button", () => {
  it("starts with the first step on a fresh day", () => {
    render(DAY());

    fireEvent.click(screen.getByRole("button", { name: /^ابدأ: شاهد فيديو اليوم/ }));
    expect(where()).toBe("/discover/clip-1");
  });

  it("marks the clip watched on the way, because its page has no completion event", () => {
    render(DAY());

    fireEvent.click(screen.getByRole("button", { name: /^ابدأ:/ }));
    expect(JSON.parse(localStorage.getItem(COMPLETIONS_KEY()) ?? "[]")).toContain("listening");
  });

  it("continues with the first unfinished step", () => {
    render(DAY({ listening: { done: true } }));

    fireEvent.click(screen.getByRole("button", { name: /^كمّل: راجع 3 كلمات/ }));
    expect(where()).toBe("/review");
    // Reviews mark themselves done when a session finishes, never on a click.
    expect(JSON.parse(localStorage.getItem(COMPLETIONS_KEY()) ?? "[]")).not.toContain("flashcards");
  });

  it("congratulates a finished plan and offers the extras", () => {
    render(DAY({ listening: { done: true }, flashcards: { done: true }, "daily-challenge": { done: true } }));

    expect(screen.getByText("خلّصت خطة اليوم")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^كمّل: اقرأ نصاً قصيراً/ })).toBeInTheDocument();
  });
});

describe("the extras", () => {
  it("unfold under 'if you have time' and open like any step", () => {
    render(DAY());

    const toggle = screen.getByRole("button", { name: /إذا عندك وقت/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: /^اقرأ نصاً قصيراً —/ }));
    expect(where()).toBe("/reading");
  });
});

describe("an empty queue", () => {
  it("renders nothing rather than an empty card", () => {
    const { container } = render([task("reading", "اقرأ", { hidden: true })]);

    expect(container.querySelector("section")).toBeNull();
  });
});
