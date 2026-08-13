import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { TranslationPair } from "@/components/shared/TranslationPair";

describe("TranslationPair", () => {
  it("renders both columns in grid variant", () => {
    render(
      <TranslationPair
        variant="grid"
        literal="what news-your?"
        natural="How are you?"
      />,
    );
    expect(screen.getByText("Literal")).toBeInTheDocument();
    expect(screen.getByText("Natural")).toBeInTheDocument();
    expect(screen.getByText("what news-your?")).toBeInTheDocument();
    expect(screen.getByText("How are you?")).toBeInTheDocument();
  });

  it("renders literal as a secondary line in compact variant", () => {
    render(
      <TranslationPair literal="what news-your?" natural="How are you?" />,
    );
    expect(screen.getByText("Literal")).toBeInTheDocument();
    expect(screen.getByText("what news-your?")).toBeInTheDocument();
    expect(screen.getByText("How are you?")).toBeInTheDocument();
  });

  it("hides the literal line when literal is missing or empty", () => {
    const { rerender } = render(<TranslationPair natural="How are you?" />);
    expect(screen.queryByText("Literal")).not.toBeInTheDocument();
    expect(screen.getByText("How are you?")).toBeInTheDocument();

    rerender(<TranslationPair literal="   " natural="How are you?" />);
    expect(screen.queryByText("Literal")).not.toBeInTheDocument();

    rerender(<TranslationPair literal={null} natural="How are you?" />);
    expect(screen.queryByText("Literal")).not.toBeInTheDocument();
  });
});
