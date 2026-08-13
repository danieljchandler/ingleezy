import { fireEvent, render, screen } from "@testing-library/react";
import { BookOpen } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { LessonPlanRow } from "@/hooks/useTopic";
import { LessonPlanSection } from "./LessonPlanSection";

/**
 * One section of the authored lesson plan.
 *
 * The rows come from spreadsheet sheets whose column headers differ from lesson
 * to lesson, so they arrive as `Record<string, string>` with keys nobody can
 * predict. `planRows` turns each into a headline plus details without assuming a
 * schema; this component's job is to present that, and — just as importantly —
 * to disappear entirely when there is nothing worth showing, which is the state
 * of every lesson imported before the importer was fixed.
 */

const rows = (...list: LessonPlanRow[]) => list;

interface Options {
  title?: string;
  rows?: LessonPlanRow[];
  defaultOpen?: boolean;
  blurb?: string;
}

const SEQUENCE: LessonPlanRow[] = [
  { Step: "1", Activity: "Greet the shopkeeper", Notes: "Use the formal form" },
  { Step: "2", Activity: "Ask the price" },
];

function renderSection({
  title = "Lesson sequence",
  rows: list = SEQUENCE,
  defaultOpen = true,
  blurb,
}: Options = {}) {
  return render(
    <LessonPlanSection
      title={title}
      icon={BookOpen}
      rows={list}
      defaultOpen={defaultOpen}
      blurb={blurb}
    />,
  );
}

const toggle = (name = "Lesson sequence") => screen.getByRole("button", { name: new RegExp(name) });

describe("LessonPlanSection — deciding whether to appear", () => {
  it("renders nothing for a lesson with no plan", () => {
    // Every lesson imported before the importer kept these columns is in this
    // state, so an empty card here would appear on most of the library.
    const { container } = renderSection({ rows: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when every row is blank", () => {
    const { container } = renderSection({ rows: rows({}, { Step: "", Activity: "  " }) });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the rows carry only a number", () => {
    // A row with an index and no content is a leftover from a sheet where the
    // author numbered ahead of writing.
    const { container } = renderSection({ rows: rows({ Step: "3" }) });
    expect(container).toBeEmptyDOMElement();
  });

  it("appears as soon as one row has content", () => {
    renderSection({ rows: rows({}, { Activity: "Ask the price" }) });
    expect(screen.getByText("Ask the price")).toBeInTheDocument();
  });

  it("drops the blank rows and keeps the rest", () => {
    renderSection({ rows: rows({ Activity: "One" }, {}, { Activity: "Two" }) });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("LessonPlanSection — the header", () => {
  it("names the section", () => {
    renderSection({ title: "Real-world prompts" });
    expect(screen.getByText("Real-world prompts")).toBeInTheDocument();
  });

  it("marks whether it is open", () => {
    renderSection({ defaultOpen: true });
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("can start closed, for supporting material", () => {
    // The main sequence opens; the extras stay folded so the lesson page is not
    // a wall of plan before the vocabulary.
    renderSection({ defaultOpen: false });
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Greet the shopkeeper")).not.toBeInTheDocument();
  });

  it("opens on a tap", () => {
    renderSection({ defaultOpen: false });
    fireEvent.click(toggle());
    expect(screen.getByText("Greet the shopkeeper")).toBeInTheDocument();
  });

  it("closes again", () => {
    renderSection({ defaultOpen: true });
    fireEvent.click(toggle());
    expect(screen.queryByText("Greet the shopkeeper")).not.toBeInTheDocument();
  });

  it("turns the chevron over when open", () => {
    const { container } = renderSection({ defaultOpen: true });
    const chevrons = [...container.querySelectorAll("svg")];
    expect(chevrons.some((svg) => svg.getAttribute("class")?.includes("rotate-180"))).toBe(true);
  });
});

describe("LessonPlanSection — the rows", () => {
  it("shows each row's headline", () => {
    renderSection();
    expect(screen.getByText("Greet the shopkeeper")).toBeInTheDocument();
    expect(screen.getByText("Ask the price")).toBeInTheDocument();
  });

  it("shows the remaining columns as detail", () => {
    renderSection();
    expect(screen.getByText("Use the formal form")).toBeInTheDocument();
  });

  it("joins several detail columns into one line", () => {
    renderSection({
      rows: rows({ Activity: "Haggle", Notes: "Be polite", Vocab: "كم سعره" }),
    });
    expect(screen.getByText("Be polite · كم سعره")).toBeInTheDocument();
  });

  it("shows no detail line for a row that is only a headline", () => {
    const { container } = renderSection({ rows: rows({ Activity: "Ask the price" }) });
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("numbers the rows from the sheet's own index column", () => {
    // The author's numbering can skip or repeat deliberately; overriding it
    // with the array position would silently rewrite the lesson.
    renderSection({ rows: rows({ Step: "7", Activity: "Pay" }) });
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("falls back to the row's position when the sheet has no index", () => {
    renderSection({ rows: rows({ Activity: "One" }, { Activity: "Two" }) });
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("presents the rows as an ordered list", () => {
    const { container } = renderSection();
    expect(container.querySelector("ol")).toBeInTheDocument();
  });
});

describe("LessonPlanSection — the blurb", () => {
  it("shows the caller's introduction above the list", () => {
    renderSection({ blurb: "Work through these in order." });
    expect(screen.getByText("Work through these in order.")).toBeInTheDocument();
  });

  it("leaves it out when there is none", () => {
    renderSection();
    expect(screen.queryByText("Work through these in order.")).not.toBeInTheDocument();
  });

  it("hides it along with the list when collapsed", () => {
    renderSection({ blurb: "Work through these in order.", defaultOpen: false });
    expect(screen.queryByText("Work through these in order.")).not.toBeInTheDocument();
  });
});
