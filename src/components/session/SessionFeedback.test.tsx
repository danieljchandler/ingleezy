import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionFeedback } from "./SessionFeedback";

describe("SessionFeedback", () => {
  it("says the verdict in words, not only in colour", () => {
    render(<SessionFeedback correct title="صح!" onContinue={vi.fn()} />);

    // A learner who cannot see the green must still get the answer.
    expect(screen.getByText("صح!")).toBeInTheDocument();
  });

  it("gives the right answer when the learner missed it", () => {
    render(
      <SessionFeedback
        correct={false}
        title="مو بالضبط"
        detail="الجواب: يؤجّل"
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("مو بالضبط")).toBeInTheDocument();
    expect(screen.getByText("الجواب: يؤجّل")).toBeInTheDocument();
  });

  it("moves on when asked", () => {
    const onContinue = vi.fn();
    render(<SessionFeedback correct title="صح!" onContinue={onContinue} />);

    fireEvent.click(screen.getByRole("button", { name: "واصل" }));

    expect(onContinue).toHaveBeenCalled();
  });

  it("announces politely rather than interrupting", () => {
    render(<SessionFeedback correct title="صح!" onContinue={vi.fn()} />);

    // The learner just acted on purpose and is looking at the result; an
    // assertive live region would talk over their own screen reader.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("carries the tone through to the continue button", () => {
    const { rerender } = render(<SessionFeedback correct title="صح" onContinue={vi.fn()} />);
    expect(screen.getByRole("button", { name: "واصل" })).toHaveClass("bg-success");

    rerender(<SessionFeedback correct={false} title="خطأ" onContinue={vi.fn()} />);
    expect(screen.getByRole("button", { name: "واصل" })).toHaveClass("bg-destructive");
  });
});
