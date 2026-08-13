import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TranslationPair } from "./TranslationPair";

/**
 * A natural translation, optionally with its word-for-word gloss.
 *
 * The literal line is the one that teaches: "went-I the-market" shows where the
 * pronoun went and why there is a definite article the English does not have.
 * But most content predates the field, so the component has to read correctly
 * with it and without it.
 */

describe("TranslationPair — the compact form", () => {
  it("shows the natural translation", () => {
    render(<TranslationPair natural="I went to the market" />);
    expect(screen.getByText("I went to the market")).toBeInTheDocument();
  });

  it("adds the literal gloss underneath, labelled", () => {
    render(<TranslationPair natural="I went to the market" literal="went-I the-market" />);
    expect(screen.getByText("went-I the-market")).toBeInTheDocument();
    expect(screen.getByText("Literal")).toBeInTheDocument();
  });

  it("shows only the natural line for content that predates the field", () => {
    render(<TranslationPair natural="I went to the market" />);
    expect(screen.queryByText("Literal")).not.toBeInTheDocument();
  });

  it("treats an explicit null the same as absent", () => {
    render(<TranslationPair natural="I went to the market" literal={null} />);
    expect(screen.queryByText("Literal")).not.toBeInTheDocument();
  });

  it("treats a whitespace-only gloss as absent", () => {
    // The generator emits "" or " " rather than omitting the key, so a trim is
    // what stands between a label and an empty line.
    render(<TranslationPair natural="I went to the market" literal="   " />);
    expect(screen.queryByText("Literal")).not.toBeInTheDocument();
  });

  it("stays left-to-right inside an Arabic page", () => {
    const { container } = render(<TranslationPair natural="I went to the market" />);
    expect(container.querySelector("[dir='ltr']")).toBeInTheDocument();
  });

  it("is the default form", () => {
    const { container } = render(<TranslationPair natural="x" literal="y" />);
    expect(container.querySelector(".grid")).toBeNull();
  });
});

describe("TranslationPair — the grid form", () => {
  it("puts the two side by side, each labelled", () => {
    render(
      <TranslationPair variant="grid" natural="I went to the market" literal="went-I the-market" />,
    );
    expect(screen.getByText("Literal")).toBeInTheDocument();
    expect(screen.getByText("Natural")).toBeInTheDocument();
    expect(screen.getByText("went-I the-market")).toBeInTheDocument();
    expect(screen.getByText("I went to the market")).toBeInTheDocument();
  });

  it("lays out in two columns", () => {
    const { container } = render(<TranslationPair variant="grid" natural="x" literal="y" />);
    expect(container.querySelector(".grid")).toBeInTheDocument();
  });

  it("drops the Literal column when there is no gloss", () => {
    // `hasLiteral` was computed and used only by the compact branch, so the
    // grid rendered its heading and paragraph unconditionally — a heading over
    // an empty half of the Translate page, which is most of the older content.
    render(<TranslationPair variant="grid" natural="I went to the market" />);
    expect(screen.queryByText("Literal")).not.toBeInTheDocument();
    expect(screen.getByText("Natural")).toBeInTheDocument();
  });

  it("drops it for a whitespace-only gloss too", () => {
    render(<TranslationPair variant="grid" natural="I went to the market" literal="  " />);
    expect(screen.queryByText("Literal")).not.toBeInTheDocument();
  });

  it("collapses to one column rather than leaving a gap", () => {
    const { container } = render(
      <TranslationPair variant="grid" natural="I went to the market" />,
    );
    expect(container.querySelector(".sm\\:grid-cols-2")).toBeNull();
  });
});
