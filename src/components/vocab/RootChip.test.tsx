import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveRootFamiliesEnabled } from "@/lib/rootFamilyPrefs";
import { RootChip } from "./RootChip";

/**
 * A curriculum word's Arabic root, as one chip.
 *
 * `vocabulary_words` gained a `root` column long after every lesson in it was
 * authored, so the overwhelming majority of rows have none. That makes the
 * empty case the normal one, not the edge: this has to render nothing at all
 * rather than an empty chip, or a freshly imported lesson becomes a grid of
 * blank boxes.
 *
 * It also refuses anything `rootKey` cannot read. A root the matcher would not
 * match on is one a learner should not be shown — showing it would imply a
 * connection to other words that nothing else in the app would honour.
 */

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("what it shows", () => {
  it("spaces the radicals so the chip reads as a root", () => {
    render(<RootChip root="ك ت ب" />);

    expect(screen.getByText("ك · ت · ب")).toBeInTheDocument();
  });

  it("normalises whatever spelling was stored", () => {
    // The column holds free text: hyphens from one writer, spaces from another.
    render(<RootChip root="ك-ت-ب" />);

    expect(screen.getByText("ك · ت · ب")).toBeInTheDocument();
  });

  it("renders right-to-left, so the first radical sits rightmost", () => {
    render(<RootChip root="كتب" />);

    expect(screen.getByText("ك · ت · ب")).toHaveAttribute("dir", "rtl");
  });
});

describe("what it refuses to show", () => {
  it("renders nothing for a word nobody has looked up", () => {
    const { container } = render(<RootChip root={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a word known to have no root", () => {
    // '' is the backfill's record that it asked — a loanword, a particle.
    const { container } = render(<RootChip root="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a value that is not a root", () => {
    for (const notARoot of ["n/a", "kataba", "من الكتاب"]) {
      const { container } = render(<RootChip root={notARoot} />);
      expect(container).toBeEmptyDOMElement();
    }
  });

  it("renders nothing while the learner has roots switched off", () => {
    saveRootFamiliesEnabled(false);

    const { container } = render(<RootChip root="ك ت ب" />);

    // One switch covers every surface — the footnote under a reviewed card and
    // the chips on curriculum words alike.
    expect(container).toBeEmptyDOMElement();
  });
});
