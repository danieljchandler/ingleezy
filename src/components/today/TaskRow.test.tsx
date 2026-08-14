import { act, fireEvent, screen } from "@testing-library/react";
import { BookOpen } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aProfile } from "@/test/support/factories";
import { TaskRow } from "./TaskRow";

/**
 * One line of the Today list.
 *
 * Today is the page a learner opens every day, and it is a list of these — so
 * the row has to answer "what, how long, and have I done it?" without being
 * read. Hence the time estimate on every row (the commonest reason a session
 * does not start is not knowing what it will cost) and a completed row that
 * stays visible rather than disappearing, because the list doubles as the
 * record of the day.
 */

let cleanup: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  title?: string;
  subtitle?: string;
  countBadge?: string;
  estMinutes?: number;
  done?: boolean;
  hint?: { title: string; body: string };
  dialect?: string;
}

function render({
  title = "Review",
  subtitle,
  countBadge,
  estMinutes = 8,
  done = false,
  hint,
  dialect = "Gulf",
}: Options = {}) {
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const onClick = vi.fn();
  const harness = renderWithProviders(
    <TaskRow
      title={title}
      subtitle={subtitle}
      countBadge={countBadge}
      estMinutes={estMinutes}
      icon={BookOpen}
      done={done}
      onClick={onClick}
      hint={hint}
    />,
    // DialectProvider syncs from the profile on mount and overwrites what is in
    // localStorage, so the persona's profile has to agree.
    {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("profiles", [aProfile({ preferred_dialect: dialect })]),
    },
  );
  cleanup = harness.cleanup;
  return { ...harness, onClick };
}

const row = () => screen.getByRole("button", { name: /دقائق$/ });
const rail = (container: HTMLElement) => container.querySelector("[aria-hidden]")!;

describe("what the row says", () => {
  it("names the task and what it will cost", () => {
    render({ title: "Review", estMinutes: 8 });

    // The estimate is on every row because "I don't have time right now" is the
    // commonest reason a session does not start, and it is usually wrong.
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("~8 min")).toBeInTheDocument();
  });

  it("adds the detail when there is any", () => {
    render({ subtitle: "12 words from three lessons" });

    expect(screen.getByText("12 words from three lessons")).toBeInTheDocument();
  });

  it("holds the line together without one", () => {
    render();

    // Most rows have no subtitle; the estimate must not move when it is absent.
    expect(screen.getByText("~8 min")).toBeInTheDocument();
  });

  it("shows how much is waiting", () => {
    render({ countBadge: "12" });

    // The count is what turns "Review" into a decision — twelve cards and two
    // hundred are different propositions.
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("explains itself when the task needs explaining", () => {
    render({ hint: { title: "What is review?", body: "Spaced repetition, briefly." } });

    // Some rows name a mechanism rather than an activity; the hint is where
    // that gets a sentence without cluttering the row.
    expect(screen.getByRole("button", { name: /What is review/i })).toBeInTheDocument();
  });

  it("carries no hint by default", () => {
    render();

    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("describes itself to a screen reader", () => {
    render({ title: "Review", estMinutes: 8 });

    // The row is a single button full of decorative spans; without this its
    // accessible name would be the whole jumble.
    expect(row()).toHaveAccessibleName("Review — تقريباً 8 دقائق");
  });
});

describe("once the task is done", () => {
  it("says so in its own name", () => {
    render({ done: true });

    // A row that only looks different is not different to somebody using a
    // screen reader.
    expect(screen.getByRole("button", { name: /^مكتملة:/ })).toHaveAccessibleName(
      "مكتملة: Review — تقريباً 8 دقائق",
    );
  });

  it("strikes the title through and ticks the tile", () => {
    const { container } = render({ done: true });

    expect(screen.getByText("Review").className).toContain("line-through");
    // The icon becomes a tick: the tile is the part read at a glance down a
    // list of five.
    expect(container.querySelector("svg path[d^='M5 12.5']")).not.toBeNull();
  });

  it("stays on the list rather than disappearing", () => {
    render({ done: true });

    // Today doubles as the record of the day. A row that vanished would leave
    // the learner unsure whether they had done it or imagined it.
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("~8 min")).toBeInTheDocument();
  });

  it("drops the count", () => {
    render({ done: true, countBadge: "12" });

    // Nothing is waiting any more, and a stale twelve would read as work
    // outstanding.
    expect(screen.queryByText("12")).toBeNull();
  });

  it("fades the dialect rail", () => {
    const { container } = render({ done: true });

    expect(rail(container).className).toContain("opacity-40");
  });

  it("can still be opened", () => {
    const { onClick } = render({ done: true });

    fireEvent.click(row());

    // Reviewing again, or looking at what was done, are both reasonable.
    expect(onClick).toHaveBeenCalled();
  });
});

describe("the dialect rail", () => {
  it.each([
    ["Gulf", "teal"],
    ["Egyptian", "amber"],
    ["Yemeni", "red"],
  ])("colours the row for %s", async (dialect, hue) => {
    const { container } = render({ dialect });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Today looks the same in every dialect apart from this. It is the only
    // ambient cue that a learner switching modules is where they think they are.
    expect(rail(container).className).toContain(hue);
  });

  it("falls back to the Gulf colours for an unknown dialect", async () => {
    const { container } = render({ dialect: "Levantine" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // A dialect added to the data before the palette would otherwise render an
    // uncoloured rail.
    expect(rail(container).className).toContain("teal");
  });
});

describe("opening the task", () => {
  it("calls back when tapped", () => {
    const { onClick } = render();

    fireEvent.click(row());

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is the whole row, not a small target inside it", () => {
    render();

    // On a phone this is the primary control on the page; anything smaller
    // than the row is a miss waiting to happen. The control is now a
    // full-bleed overlay (inset-0) under the content — it became an overlay
    // when the row learned to host an InfoHint, which is itself a <button>
    // and cannot legally nest inside one.
    expect(row().className).toContain("inset-0");
  });
});
