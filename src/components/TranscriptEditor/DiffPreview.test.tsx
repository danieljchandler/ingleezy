import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Segment } from "@/types/transcript";
import DiffPreview from "./DiffPreview";

/**
 * The approval gate for AI re-segmentation.
 *
 * Re-segmenting rewrites every line boundary in a transcript at once, so it is
 * never applied directly — the proposal is shown against what is already there
 * and an admin accepts it, rejects it, or picks through it line by line. The
 * component's whole job is answering "what actually changed?", and it answers
 * it by comparing start/end pairs: a suggested line whose boundary is not in
 * the original is new and gets buttons, an original whose boundary is gone is
 * struck through.
 */

const aSegment = (over: Partial<Segment> = {}): Segment => ({
  id: "s1",
  video_id: "v",
  start: 0,
  end: 1,
  text: "مرحبا",
  translation: "hello",
  confidence: 1,
  words: [],
  ...over,
});

interface Options {
  original?: Segment[];
  suggested?: Segment[];
}

function renderDiff({ original = [], suggested = [] }: Options = {}) {
  const handlers = {
    onAcceptAll: vi.fn(),
    onRejectAll: vi.fn(),
    onAcceptOne: vi.fn(),
    onRejectOne: vi.fn(),
    onKeepOne: vi.fn(),
  };
  const result = render(<DiffPreview original={original} suggested={suggested} {...handlers} />);
  return { ...result, ...handlers };
}

const acceptRow = (n = 0) => screen.getAllByRole("button", { name: "✓" })[n];
const rejectRow = (n = 0) => screen.getAllByRole("button", { name: "✗" })[n];

describe("DiffPreview — deciding what changed", () => {
  it("marks a suggested line the original did not have", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 2 })],
      suggested: [aSegment({ start: 0, end: 1, text: "first half" })],
    });
    expect(container.querySelector(".border-green-500")).toBeInTheDocument();
  });

  it("leaves an unchanged line unmarked", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 2 })],
      suggested: [aSegment({ start: 0, end: 2 })],
    });
    expect(container.querySelector(".border-green-500")).toBeNull();
  });

  it("strikes through a boundary the proposal drops", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 1, text: "gone" }), aSegment({ start: 1, end: 2 })],
      suggested: [aSegment({ start: 1, end: 2 })],
    });
    const removed = container.querySelector(".line-through");
    expect(removed).toBeInTheDocument();
    expect(removed).toHaveTextContent("gone");
  });

  it("keeps a line that only moved its text", () => {
    // The comparison is on boundaries alone, so a re-worded line at the same
    // timestamps is not a boundary change and is not offered for approval.
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 2, text: "before" })],
      suggested: [aSegment({ start: 0, end: 2, text: "after" })],
    });
    expect(container.querySelector(".border-green-500")).toBeNull();
    expect(container.querySelector(".line-through")).toBeNull();
  });

  it("shows both halves of a split as new and the whole as removed", () => {
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 2, text: "one long line" })],
      suggested: [
        aSegment({ start: 0, end: 1, text: "first" }),
        aSegment({ start: 1, end: 2, text: "second" }),
      ],
    });
    expect(container.querySelectorAll(".border-green-500")).toHaveLength(2);
    expect(container.querySelectorAll(".line-through")).toHaveLength(1);
  });

  it("copes with an empty proposal", () => {
    const { container } = renderDiff({ original: [aSegment()], suggested: [] });
    expect(container.querySelectorAll(".line-through")).toHaveLength(1);
  });

  it("copes with an empty original", () => {
    renderDiff({ original: [], suggested: [aSegment({ text: "brand new" })] });
    expect(screen.getByText("brand new")).toBeInTheDocument();
  });

  it("sees through float noise on an unchanged boundary", () => {
    // Boundaries used to be keyed by an exact string match on numbers that came
    // out of arithmetic. The re-segmentation path rebuilds start and end by
    // summing word durations, so an unchanged boundary came back as
    // 1.2000000000000002 against the original's 1.2 — and the diff turned
    // entirely green, telling the admin a proposal that changed two boundaries
    // had changed all forty.
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 0.3, text: "same line" })],
      // 0.1 + 0.2 is 0.30000000000000004.
      suggested: [aSegment({ start: 0, end: 0.1 + 0.2, text: "same line" })],
    });
    expect(container.querySelector(".border-green-500")).toBeNull();
    expect(container.querySelector(".line-through")).toBeNull();
  });

  it("still calls a boundary new when it moved by more than a millisecond", () => {
    // The tolerance is millisecond-wide, which is finer than anything the
    // editor can express and far coarser than float noise. A real edit is
    // still a real edit.
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 0.3, text: "same line" })],
      suggested: [aSegment({ start: 0, end: 0.32, text: "same line" })],
    });
    expect(container.querySelector(".border-green-500")).toBeInTheDocument();
    expect(container.querySelector(".line-through")).toBeInTheDocument();
  });
});

describe("DiffPreview — what each row shows", () => {
  it("shows the line's timings to a tenth", () => {
    renderDiff({ suggested: [aSegment({ start: 12.34, end: 15.67 })] });
    expect(screen.getByText("12.3s – 15.7s")).toBeInTheDocument();
  });

  it("shows the Arabic", () => {
    renderDiff({ suggested: [aSegment({ text: "كيف حالك" })] });
    expect(screen.getByText("كيف حالك")).toBeInTheDocument();
  });

  it("shows the translation when there is one", () => {
    renderDiff({ suggested: [aSegment({ translation: "How are you" })] });
    expect(screen.getByText("How are you")).toBeInTheDocument();
  });

  it("leaves the translation line out when there is none", () => {
    renderDiff({ suggested: [aSegment({ translation: "" })] });
    expect(screen.getByText("مرحبا")).toBeInTheDocument();
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
  });

  it("names the speaker when the model identified one", () => {
    // Speaker change detection is half the reason to re-segment, so who is
    // talking is the thing an admin checks the split against.
    renderDiff({ suggested: [aSegment({ speaker: "A" } as Partial<Segment>)] });
    expect(screen.getByText("Speaker A")).toBeInTheDocument();
  });

  it("leaves the badge off when it did not", () => {
    renderDiff({ suggested: [aSegment()] });
    expect(screen.queryByText(/^Speaker /)).not.toBeInTheDocument();
  });

  it("lays the Arabic out right-to-left and the timings left-to-right", () => {
    const { container } = renderDiff({ suggested: [aSegment({ start: 1, end: 2 })] });
    const row = container.querySelector("[dir='rtl']")!;
    expect(row).toBeInTheDocument();
    expect(screen.getByText("1.0s – 2.0s").closest("[dir='ltr']")).toBeInTheDocument();
  });
});

describe("DiffPreview — accepting and rejecting", () => {
  const split = {
    original: [aSegment({ start: 0, end: 2, text: "one long line" })],
    suggested: [
      aSegment({ start: 0, end: 1, text: "first" }),
      aSegment({ start: 1, end: 2, text: "second" }),
    ],
  };

  it("offers to take the whole proposal", () => {
    const { onAcceptAll } = renderDiff(split);
    fireEvent.click(screen.getByRole("button", { name: "Accept All" }));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it("offers to throw the whole proposal away", () => {
    const { onRejectAll } = renderDiff(split);
    fireEvent.click(screen.getByRole("button", { name: "Reject All" }));
    expect(onRejectAll).toHaveBeenCalledTimes(1);
  });

  it("offers a decision on each new line", () => {
    renderDiff(split);
    expect(screen.getAllByRole("button", { name: "✓" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "✗" })).toHaveLength(2);
  });

  it("accepts the line whose button was pressed", () => {
    const { onAcceptOne } = renderDiff(split);
    fireEvent.click(acceptRow(1));
    expect(onAcceptOne).toHaveBeenCalledWith(1);
  });

  it("rejects the line whose button was pressed", () => {
    const { onRejectOne } = renderDiff(split);
    fireEvent.click(rejectRow(0));
    expect(onRejectOne).toHaveBeenCalledWith(0);
  });

  it("indexes by position in the proposal, counting unchanged lines", () => {
    // The caller applies the decision against `suggested`, so the index has to
    // be that array's, not a count of the changed rows.
    const { onAcceptOne } = renderDiff({
      original: [aSegment({ start: 0, end: 1, text: "kept" })],
      suggested: [
        aSegment({ start: 0, end: 1, text: "kept" }),
        aSegment({ start: 1, end: 2, text: "new" }),
      ],
    });
    fireEvent.click(acceptRow(0));
    expect(onAcceptOne).toHaveBeenCalledWith(1);
  });

  it("offers no per-line decision on an unchanged line", () => {
    renderDiff({
      original: [aSegment({ start: 0, end: 1 })],
      suggested: [aSegment({ start: 0, end: 1 })],
    });
    expect(screen.queryByRole("button", { name: "✓" })).not.toBeInTheDocument();
  });

  it("offers a way to keep a boundary the proposal deletes", () => {
    // Removed lines used to be struck through with no controls at all, so the
    // only way to hold on to one was Reject All — an admin who liked nineteen
    // of twenty changes had to throw the lot out and redo the split by hand.
    const { onKeepOne } = renderDiff({
      original: [aSegment({ start: 0, end: 1, text: "merged away" }), aSegment({ start: 1, end: 3 })],
      suggested: [aSegment({ start: 0, end: 3, text: "one line now" })],
    });

    const keep = screen.getAllByRole("button", { name: "Keep" });
    expect(keep).toHaveLength(2);
    fireEvent.click(keep[0]);
    expect(onKeepOne).toHaveBeenCalledWith(0);
  });

  it("identifies the kept line by its place in the original, not in the list of removals", () => {
    // The removed rows are a filtered view, so numbering them from the filter
    // would hand the caller the wrong segment as soon as one line survives.
    const { onKeepOne } = renderDiff({
      original: [
        aSegment({ start: 0, end: 1, text: "kept" }),
        aSegment({ start: 1, end: 2, text: "merged away" }),
      ],
      suggested: [aSegment({ start: 0, end: 1, text: "kept" }), aSegment({ start: 1, end: 4 })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onKeepOne).toHaveBeenCalledWith(1);
  });

  it("still strikes the removed text through", () => {
    // The button must not be struck through with it, which is why the styling
    // moved onto the text rather than the row.
    const { container } = renderDiff({
      original: [aSegment({ start: 0, end: 1, text: "merged away" })],
      suggested: [aSegment({ start: 0, end: 3, text: "one line now" })],
    });
    expect(container.querySelector(".line-through")).toHaveTextContent("merged away");
    expect(container.querySelector(".line-through")!.querySelector("button")).toBeNull();
  });

  it("leaves removed lines bare when the caller offers no way to keep them", () => {
    const { container } = render(
      <DiffPreview
        original={[aSegment({ start: 0, end: 1, text: "merged away" })]}
        suggested={[aSegment({ start: 0, end: 3 })]}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
        onAcceptOne={vi.fn()}
        onRejectOne={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Keep" })).not.toBeInTheDocument();
    expect(container.querySelector(".line-through")).toHaveTextContent("merged away");
  });
});
