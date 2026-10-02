import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
 * That decision is made in two places that have to agree. These wrappers pick
 * the glyph an LTR page would use for each intent, and a `:dir(rtl)` rule in
 * `src/index.css` mirrors every lucide arrow and chevron. Each half looks
 * wrong read on its own, and the app once shipped with both halves flipping —
 * the mirrors cancelled out and every "continue" arrow pointed backwards. jsdom
 * cannot compute the final transform, so the test pins both halves instead:
 * the glyph each wrapper renders, and the CSS rule that turns it round.
 */

const iconName = (element: HTMLElement) =>
  element.querySelector("svg")?.getAttribute("class") ?? "";

// Resolved from the working directory: vitest always runs from the repo root.
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("navigation arrows point the way the learner reads", () => {
  it("renders back as the LTR back glyph, for the stylesheet to mirror", () => {
    const { container } = render(<IconBack />);
    expect(iconName(container)).toContain("lucide-arrow-left");
  });

  it("renders next as the LTR next glyph", () => {
    const { container } = render(<IconNext />);
    expect(iconName(container)).toContain("lucide-arrow-right");
  });

  it("does the same for the chevron forms", () => {
    const back = render(<ChevronBack />);
    const next = render(<ChevronNext />);

    expect(iconName(back.container)).toContain("lucide-chevron-left");
    expect(iconName(next.container)).toContain("lucide-chevron-right");
  });

  it("gives a row's disclosure chevron the next glyph", () => {
    // A tappable row opens *forward*, so once mirrored it points left, at the
    // end of an RTL line.
    const { container } = render(<ChevronOpen />);
    expect(iconName(container)).toContain("lucide-chevron-right");
  });

  it("relies on exactly one mirror, in the stylesheet", () => {
    // If this rule goes, every arrow above points the LTR way in an RTL page.
    for (const glyph of ["arrow-left", "arrow-right", "chevron-left", "chevron-right"]) {
      expect(css).toContain(`.lucide-${glyph}:dir(rtl)`);
    }
    expect(css).toMatch(/\.lucide-chevrons-right:dir\(rtl\)\s*\{\s*transform:\s*scaleX\(-1\)/);
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
