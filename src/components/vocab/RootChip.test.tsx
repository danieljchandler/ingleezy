import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveRootFamiliesEnabled } from "@/lib/rootFamilyPrefs";
import { RootChip } from "./RootChip";

/**
 * A curriculum word's English word family, as one chip.
 *
 * `vocabulary_words` gained a `root` column long after every lesson in it was
 * authored, so the overwhelming majority of rows have none. That makes the
 * empty case the normal one, not the edge: this has to render nothing at all
 * rather than an empty chip, or a freshly imported lesson becomes a grid of
 * blank boxes.
 *
 * It also refuses anything `familyKey` cannot read — including the Arabic roots
 * the column carried before the flip. A family the matcher would not match on
 * is one a learner should not be shown: showing it would imply a connection to
 * other words that nothing else in the app would honour.
 */

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("what it shows", () => {
  it("shows the base form as the English word it is", () => {
    render(<RootChip root="act" />);

    expect(screen.getByText("act")).toBeInTheDocument();
  });

  it("normalises whatever spelling was stored", () => {
    // The column holds free text: capitals from one writer, a stray hyphen
    // from another.
    render(<RootChip root="Act-" />);

    expect(screen.getByText("act")).toBeInTheDocument();
  });

  it("renders the family left-to-right, because it is English", () => {
    render(<RootChip root="act" />);

    // The chip used to carry dir="rtl" for the Arabic root. An English base
    // form inside an RTL page needs the opposite treatment, which is what
    // `font-english` carries.
    expect(screen.getByText("act")).toHaveClass("font-english");
  });
});

describe("what it refuses to show", () => {
  it("renders nothing for a word nobody has looked up", () => {
    const { container } = render(<RootChip root={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a word known to have no family", () => {
    // '' is the backfill's record that it asked — a function word, a name.
    const { container } = render(<RootChip root="" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a value that is not a base form", () => {
    // The Arabic entries matter: rows saved before the flip still hold roots,
    // and an Arabic root shown to an English learner as a "word family" is a
    // false connection dressed as a lesson.
    for (const notAFamily of ["n/a", "the act of doing", "ك ت ب", "كتب"]) {
      const { container } = render(<RootChip root={notAFamily} />);
      expect(container).toBeEmptyDOMElement();
    }
  });

  it("renders nothing while the learner has families switched off", () => {
    saveRootFamiliesEnabled(false);

    const { container } = render(<RootChip root="act" />);

    // One switch covers every surface — the footnote under a reviewed card and
    // the chips on curriculum words alike.
    expect(container).toBeEmptyDOMElement();
  });
});
