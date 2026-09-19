import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionFrame } from "./SessionFrame";

const base = { onExit: vi.fn(), position: 3, total: 12, children: <p>card</p> };

describe("SessionFrame — the top bar", () => {
  it("reports progress to assistive tech, not just visually", () => {
    render(<SessionFrame {...base} />);

    const bar = screen.getByRole("progressbar", { name: "تقدّمك في الجلسة" });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "12");
  });

  it("always offers a way out", () => {
    const onExit = vi.fn();
    render(<SessionFrame {...base} onExit={onExit} />);

    fireEvent.click(screen.getByRole("button", { name: "إغلاق الجلسة" }));

    // Leaving a session should never depend on the OS back button.
    expect(onExit).toHaveBeenCalled();
  });

  it("hides the bar rather than dividing by an empty queue", () => {
    render(<SessionFrame {...base} total={0} />);

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("does not run past the end when the position overshoots", () => {
    // A queue that shrinks under a learner mid-session would otherwise paint a
    // bar wider than its track.
    const { container } = render(<SessionFrame {...base} position={20} total={12} />);

    expect(container.querySelector(".bg-primary")).toHaveStyle({ width: "100%" });
  });
});

describe("SessionFrame — the bottom slot", () => {
  it("shows the action when there is no verdict", () => {
    render(<SessionFrame {...base} action={<button type="button">تحقّق</button>} />);

    expect(screen.getByRole("button", { name: "تحقّق" })).toBeInTheDocument();
  });

  it("gives the slot to the verdict, replacing the action", () => {
    render(
      <SessionFrame
        {...base}
        action={<button type="button">تحقّق</button>}
        feedback={<button type="button">واصل</button>}
      />,
    );

    // One action at a time: a verdict that sat beside the button it answers
    // would leave two primary controls competing.
    expect(screen.getByRole("button", { name: "واصل" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تحقّق" })).toBeNull();
  });
});
