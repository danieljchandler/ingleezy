import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("names the screen as its top-level heading", () => {
    render(<PageHeader title="كلماتي" />);

    // One h1 per screen: it is what a screen reader's heading list is for.
    const heading = screen.getByRole("heading", { level: 1, name: "كلماتي" });
    expect(heading).toBeInTheDocument();
  });

  it("explains the screen when a subtitle is given", () => {
    render(<PageHeader title="أخطاؤك" subtitle="ما الذي يتكرر تعثرك فيه." />);

    expect(screen.getByText("ما الذي يتكرر تعثرك فيه.")).toBeInTheDocument();
  });

  it("keeps the trailing slot out of the heading", () => {
    render(<PageHeader title="اكتشف" action={<button type="button">تصفية</button>} />);

    // The action sits beside the title, not inside it: folding a control into
    // the heading would put its label in the heading's accessible name.
    expect(screen.getByRole("heading", { level: 1, name: "اكتشف" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تصفية" })).toBeInTheDocument();
  });

  it("sets the title in ink rather than the brand colour", () => {
    render(<PageHeader title="كلماتي" />);

    // The palette reserves its one colour for things you can tap. A heading
    // wearing it reads as an action that does nothing when pressed.
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-foreground");
  });
});
