import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookOpen } from "lucide-react";
import { EmptyState } from "./EmptyState";

describe("EmptyState — what it says", () => {
  it("names what is missing", () => {
    render(<EmptyState title="ما فيه كلمات محفوظة" />);

    // A heading, not a paragraph: this is the screen's subject while it is
    // empty, and a screen reader moving by heading should land on it.
    expect(screen.getByRole("heading", { name: "ما فيه كلمات محفوظة" })).toBeInTheDocument();
  });

  it("carries a way out when there is one", () => {
    render(
      <EmptyState title="ما فيه كلمات" action={<button type="button">رجوع للرئيسية</button>} />,
    );

    expect(screen.getByRole("button", { name: "رجوع للرئيسية" })).toBeInTheDocument();
  });

  it("works with nothing but a title", () => {
    const { container } = render(<EmptyState title="لا شيء هنا" />);

    // Several call sites have no icon, no body and nowhere to send anyone.
    expect(screen.getByRole("heading", { name: "لا شيء هنا" })).toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
  });

  it("hides its icon from assistive tech", () => {
    const { container } = render(<EmptyState icon={BookOpen} title="فاضي" />);

    // The icon repeats the title; announcing it would say the same thing twice.
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden");
  });
});

describe("EmptyState — page versus inline", () => {
  it("gives a whole empty screen room to breathe", () => {
    const { container } = render(<EmptyState title="فاضي" />);

    expect(container.firstElementChild).toHaveClass("py-20");
  });

  it("stays compact inside a section that is only partly empty", () => {
    const { container } = render(<EmptyState title="فاضي" variant="inline" />);

    // Inline means the rest of the page has content; a page-sized gap here
    // would push it off the screen.
    expect(container.firstElementChild).toHaveClass("py-10");
    expect(container.firstElementChild).not.toHaveClass("py-20");
  });
});
