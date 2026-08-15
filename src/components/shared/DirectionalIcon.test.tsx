import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ChevronBack,
  ChevronNext,
  ChevronOpen,
  IconBack,
  IconNext,
} from "./DirectionalIcon";

/**
 * The whole point of this module is one decision: in an RTL page, back points
 * right and forward points left.
 *
 * It is worth a test precisely because it looks wrong when read. Someone
 * scanning `IconBack = ArrowRight` will eventually "fix" it, and nothing else
 * in the suite would notice — Playwright asserts on accessible names, not on
 * which way a glyph happens to point. So the assertion is on the rendered
 * icon's own class, which lucide stamps with its name.
 */

const iconName = (element: HTMLElement) =>
  element.querySelector("svg")?.getAttribute("class") ?? "";

describe("navigation arrows point the way the learner reads", () => {
  it("sends back to the right, because that is where an Arabic reader came from", () => {
    const { container } = render(<IconBack />);
    expect(iconName(container)).toContain("lucide-arrow-right");
  });

  it("sends next to the left", () => {
    const { container } = render(<IconNext />);
    expect(iconName(container)).toContain("lucide-arrow-left");
  });

  it("mirrors the chevron forms the same way", () => {
    const back = render(<ChevronBack />);
    const next = render(<ChevronNext />);

    expect(iconName(back.container)).toContain("lucide-chevron-right");
    expect(iconName(next.container)).toContain("lucide-chevron-left");
  });

  it("points a row's disclosure chevron at the end of the line, not the start", () => {
    // A tappable row opens *forward*, so in RTL its chevron sits and points
    // left — the same glyph as next, kept separate so the two can diverge.
    const { container } = render(<ChevronOpen />);
    expect(iconName(container)).toContain("lucide-chevron-left");
  });
});

describe("passing props through", () => {
  it("keeps the caller's className, which is how every call site sizes them", () => {
    const { container } = render(<IconBack className="h-4 w-4 text-primary" />);
    const cls = iconName(container);

    expect(cls).toContain("h-4");
    expect(cls).toContain("w-4");
    expect(cls).toContain("text-primary");
  });
});
