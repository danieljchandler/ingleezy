import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { FushaLine } from "@/components/shared/FushaLine";

/**
 * The Fusha row shows an Arabic sentence nobody said — the dialect line
 * rewritten in فصحى — so the two things it must never do are render something
 * that isn't there, and render the dialect line back at the reader under a
 * heading claiming it was converted.
 */

const DIALECT = "شلونك اليوم";
const FUSHA = "كيف حالك اليوم";

describe("FushaLine", () => {
  it("shows the rendering under a labelled row", () => {
    render(<FushaLine dialect={DIALECT} fusha={FUSHA} />);

    expect(screen.getByText(FUSHA)).toBeInTheDocument();
    expect(screen.getByText("Fusha · فصحى")).toBeInTheDocument();
  });

  it("renders right-to-left", () => {
    render(<FushaLine dialect={DIALECT} fusha={FUSHA} />);

    expect(screen.getByText(FUSHA).getAttribute("dir")).toBe("rtl");
  });

  it("renders nothing without a rendering to show", () => {
    const { container, rerender } = render(<FushaLine dialect={DIALECT} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<FushaLine dialect={DIALECT} fusha="   " />);
    expect(container).toBeEmptyDOMElement();

    rerender(<FushaLine dialect={DIALECT} fusha={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says so instead of repeating a line that was already Fusha", () => {
    render(<FushaLine dialect={FUSHA} fusha={FUSHA} />);

    expect(screen.getByText("Already فصحى")).toBeInTheDocument();
    expect(screen.queryByText("Fusha · فصحى")).not.toBeInTheDocument();
  });

  it("ignores tashkeel when deciding whether anything changed", () => {
    // The dialect line comes back from Farasa vocalised and the Fusha pass does
    // not vocalise, so a byte comparison would call every line a conversion.
    render(<FushaLine dialect="كَيْفَ حَالُك؟" fusha="كيف حالك" />);

    expect(screen.getByText("Already فصحى")).toBeInTheDocument();
  });

  it("centres the inline variant for the active-subtitle panel", () => {
    render(<FushaLine dialect={DIALECT} fusha={FUSHA} variant="inline" />);

    expect(screen.getByText(FUSHA).className).toContain("text-center");
  });
});
