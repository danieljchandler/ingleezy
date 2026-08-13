import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import Toolbar from "./Toolbar";
import type { Segment } from "@/types/transcript";

/**
 * The transcript editor's toolbar — undo, the AI actions, and the gate in front
 * of export.
 *
 * Two things here do real work rather than just dispatching. The warning button
 * is the editor's only view of the timing problems across the whole transcript,
 * which are invisible line by line: a gap is a property of two segments and an
 * overlap is a property of the pair that will collide in the player. And the
 * export is blocked while any overlap remains, because an SRT with overlapping
 * cues renders as two subtitles on top of each other.
 */

const aSegment = (over: Partial<Segment> = {}): Segment => ({
  id: "seg-1",
  video_id: "vid-1",
  start: 0,
  end: 2,
  text: "شلونك",
  translation: "how are you",
  confidence: 0.9,
  words: [],
  ...over,
});

/** Two clean, consecutive segments: no gaps, no overlaps, nothing to warn about. */
const CLEAN: Segment[] = [
  aSegment({ id: "seg-1", start: 0, end: 2 }),
  aSegment({ id: "seg-2", start: 2, end: 4, text: "زين", translation: "good" }),
];

/** The second starts before the first has finished — the one blocking error. */
const OVERLAPPING: Segment[] = [
  aSegment({ id: "seg-1", start: 0, end: 3 }),
  aSegment({ id: "seg-2", start: 2, end: 4, text: "زين", translation: "good" }),
];

/** Four seconds of silence between the two — worth flagging, not blocking. */
const GAPPED: Segment[] = [
  aSegment({ id: "seg-1", start: 0, end: 2 }),
  aSegment({ id: "seg-2", start: 6, end: 8, text: "زين", translation: "good" }),
];

let cleanup: (() => void) | undefined;
let clicked: HTMLAnchorElement[] = [];
let objectUrls: string[] = [];

beforeEach(() => {
  clicked = [];
  objectUrls = [];
  // The export builds an <a download> and clicks it; jsdom would navigate.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:srt");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    objectUrls.push(url);
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

type Props = Partial<Parameters<typeof Toolbar>[0]>;

function render(over: Props = {}) {
  const handlers = {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSuggestBreaks: vi.fn(),
    onAIResegment: vi.fn(),
    onRetranslateAllStale: vi.fn(),
    onCancelAI: vi.fn(),
  };
  const harness = renderWithProviders(
    <Toolbar
      segments={CLEAN}
      canUndo={false}
      canRedo={false}
      staleCount={0}
      {...handlers}
      {...over}
    />,
    { persona: "admin" },
  );
  cleanup = harness.cleanup;
  return { ...harness, ...handlers };
}

const button = (name: RegExp | string) => screen.getByRole("button", { name });

describe("undo and redo", () => {
  it("stays dead until there is something to undo", () => {
    render();

    expect(button(/undo/i)).toBeDisabled();
    expect(button(/redo/i)).toBeDisabled();
  });

  it("undoes on request", () => {
    const { onUndo } = render({ canUndo: true });

    fireEvent.click(button(/undo/i));

    expect(onUndo).toHaveBeenCalled();
  });

  it("redoes on request", () => {
    const { onRedo } = render({ canRedo: true });

    fireEvent.click(button(/redo/i));

    expect(onRedo).toHaveBeenCalled();
  });

  it("names the shortcut on the button itself", () => {
    render({ canUndo: true });

    // An editor working through four hundred lines learns the keys from here.
    expect(button(/undo/i)).toHaveAttribute("title", "Undo (Cmd+Z)");
  });
});

describe("the AI actions", () => {
  it("offers re-segmentation and break suggestions", () => {
    render();

    expect(button(/AI Re-segment/)).toBeInTheDocument();
    expect(button(/Suggest Breaks/)).toBeInTheDocument();
  });

  it("leaves out the actions the page did not wire up", () => {
    render({ onAIResegment: undefined, onSuggestBreaks: undefined });

    // The toolbar is shared with screens that have no AI budget attached.
    expect(screen.queryByRole("button", { name: /AI Re-segment/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Suggest Breaks/ })).toBeNull();
  });

  it("asks for a re-segmentation", () => {
    const { onAIResegment } = render();

    fireEvent.click(button(/AI Re-segment/));

    expect(onAIResegment).toHaveBeenCalled();
  });

  it("offers to re-translate the lines whose Arabic has moved on", () => {
    const { onRetranslateAllStale } = render({ staleCount: 7 });

    // Doing them one at a time is seven round trips and seven decisions; the
    // count is what makes it worth a single button.
    fireEvent.click(button(/Re-translate stale \(7\)/));

    expect(onRetranslateAllStale).toHaveBeenCalled();
  });

  it("says nothing about stale translations when there are none", () => {
    render({ staleCount: 0 });

    expect(screen.queryByRole("button", { name: /Re-translate stale/ })).toBeNull();
  });

  it("replaces the actions with a way out while the AI is working", () => {
    const { onCancelAI } = render({ aiStatus: "loading", staleCount: 3 });

    // A re-segmentation rewrites every line; an editor who started one by
    // mistake needs to stop it before it lands.
    expect(screen.getByText("AI rethinking timing…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /AI Re-segment/ })).toBeNull();
    fireEvent.click(button(/cancel/i));
    expect(onCancelAI).toHaveBeenCalled();
  });
});

describe("the timing warnings", () => {
  it("says so when the transcript is clean", () => {
    render();

    expect(button(/✓ Clean/)).toBeInTheDocument();
  });

  it("counts warnings that do not block anything", () => {
    render({ segments: GAPPED });

    // A four-second gap is usually music or silence and is often correct; it is
    // worth a look, not a block.
    expect(button(/1 warning/)).toBeInTheDocument();
  });

  it("counts errors separately from warnings", () => {
    render({ segments: OVERLAPPING });

    expect(button(/⚠ 1 error/)).toBeInTheDocument();
  });

  it("lists what is actually wrong when asked", () => {
    render({ segments: OVERLAPPING });

    fireEvent.click(button(/⚠ 1 error/));

    // A count tells an editor there is a problem; only the message tells them
    // which two lines to look at.
    expect(screen.getByText(/Segments 1 and 2 overlap by 1.00s/)).toBeInTheDocument();
  });

  it("folds the list away again", () => {
    render({ segments: OVERLAPPING });
    fireEvent.click(button(/⚠ 1 error/));

    fireEvent.click(button(/⚠ 1 error/));

    expect(screen.queryByText(/overlap by/)).toBeNull();
  });

  it("has nothing to list on a clean transcript", () => {
    const { container } = render();

    fireEvent.click(button(/✓ Clean/));

    expect(container.querySelector(".basis-full")).toBeNull();
  });
});

describe("exporting subtitles", () => {
  it("writes an SRT of the current segments", () => {
    render();

    fireEvent.click(button(/Export SRT/));

    // The SRT is what goes to the player, so it has to come from the segments
    // as they are now rather than from anything saved earlier.
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("transcript.srt");
    expect(clicked[0].href).toContain("blob:srt");
  });

  it("releases the file it made", () => {
    render();

    fireEvent.click(button(/Export SRT/));

    // Object URLs pin their blob for the lifetime of the document; an editor
    // exporting repeatedly would leak every version.
    expect(objectUrls).toEqual(["blob:srt"]);
  });

  it("refuses while two lines still overlap", () => {
    render({ segments: OVERLAPPING });

    // Overlapping cues render as two subtitles on top of each other, which is
    // not something anyone notices until it is published.
    expect(button(/Export SRT/)).toBeDisabled();
    expect(button(/Export SRT/)).toHaveAttribute("title", "Fix errors before exporting");
  });

  it("allows an export that only has warnings against it", () => {
    render({ segments: GAPPED });

    expect(button(/Export SRT/)).toBeEnabled();
  });
});

describe("the publish checklist", () => {
  it("stays out of the way until it is opened", () => {
    render();

    expect(screen.queryByText(/No overlapping segments/i)).toBeNull();
  });

  it("shows what still has to be true before publishing", () => {
    render({ segments: OVERLAPPING });

    fireEvent.click(button(/Checklist/));

    // Export is one gate; publishing to learners is a stricter one, and the
    // list is the difference between the two.
    expect(screen.getByText(/No overlapping segments/i)).toBeInTheDocument();
  });

  it("marks a transcript that has no missing translations", () => {
    render();
    fireEvent.click(button(/Checklist/));

    const line = screen.getByText(/translation/i).closest("div")!;
    expect(line.textContent).toContain("✓");
  });

  it("marks the checks a transcript fails", () => {
    render({
      segments: [aSegment({ translation: "" }), aSegment({ id: "seg-2", start: 2, end: 4 })],
    });
    fireEvent.click(button(/Checklist/));

    const line = screen.getByText(/translation/i).closest("div")!;
    expect(line.textContent).toContain("✗");
  });
});

describe("the shortcut list", () => {
  it("stays closed until it is wanted", () => {
    render();

    expect(screen.queryByText(/Nudge active segment start/)).toBeNull();
  });

  it("explains the keys that have no button", () => {
    render();

    fireEvent.click(button(/Shortcuts/));

    // Nudging a timestamp by 100ms is the most-used action in the editor and
    // there is deliberately no button for it — a mouse is too slow.
    expect(screen.getByText(/Nudge active segment start/)).toBeInTheDocument();
    expect(screen.getByText("[ / ]")).toBeInTheDocument();
  });
});
