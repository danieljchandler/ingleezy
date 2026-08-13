import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import SegmentCard from "./SegmentCard";
import type { Segment } from "@/types/transcript";

/**
 * One line of a transcript, as the editor works on it.
 *
 * Correcting machine transcription of dialect Arabic is done line by line for
 * an hour at a stretch, so the affordances here are chosen for speed: click a
 * word to edit, Enter to split at the cursor, ⌘Enter to save, Escape to
 * abandon. An editor who has to reach for a mouse between every line does a
 * fraction of the work.
 *
 * The two nudges — Fix Arabic and Re-translate — appear only when they are
 * worth offering. A "fix" button on a line the recogniser was confident about
 * invites a rewrite of something that was already right, and a re-translate on
 * a line whose Arabic has not changed is a paid call for no change.
 */

const aWord = (word: string, start: number, end: number, confidence = 0.9) => ({
  word,
  start,
  end,
  confidence,
});

const aSegment = (over: Partial<Segment> = {}): Segment => ({
  id: "seg-1",
  video_id: "vid-1",
  start: 2,
  end: 4,
  text: "شلونك اليوم",
  translation: "how are you today",
  confidence: 0.92,
  words: [aWord("شلونك", 2, 3), aWord("اليوم", 3, 4)],
  ...over,
});

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

type Handlers = Partial<React.ComponentProps<typeof SegmentCard>>;

function render(over: Handlers = {}) {
  const handlers = {
    onSplit: vi.fn(),
    onSplitAtCursor: vi.fn(),
    onEditText: vi.fn(),
    onEditTranslation: vi.fn(),
    onStartChange: vi.fn(),
    onEndChange: vi.fn(),
    onSeek: vi.fn(),
  };
  const harness = renderWithProviders(
    <SegmentCard segment={aSegment()} index={0} {...handlers} {...over} />,
    { persona: "admin" },
  );
  cleanup = harness.cleanup;
  return { ...harness, ...handlers };
}

const arabicBox = () => screen.getByRole("textbox", { name: "" }) as HTMLTextAreaElement;
const startEditing = () => {
  fireEvent.click(screen.getByText("شلونك"));
};

describe("reading the line", () => {
  it("numbers it from one", () => {
    render();

    // The editor refers to lines by what they see, and a zero-indexed
    // transcript is off by one from every conversation about it.
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("shows how sure the recogniser was", () => {
    render({ segment: aSegment({ confidence: 0.62 }) });

    // The single most useful signal on the screen: it tells an editor which of
    // four hundred lines to read carefully.
    expect(screen.getByText("62%")).toBeInTheDocument();
  });

  it("names the speaker when the transcript has one", () => {
    render({ segment: aSegment({ speaker: "Speaker 2" }) });

    expect(screen.getByText("Speaker 2")).toBeInTheDocument();
  });

  it("says when a line has no translation yet", () => {
    render({ segment: aSegment({ translation: "" }) });

    // An empty row reads as a rendering bug; saying so makes it a task.
    expect(screen.getByLabelText("Missing translation")).toBeInTheDocument();
  });

  it("seeks the video to the line", () => {
    const { onSeek } = render();

    fireEvent.click(screen.getByTitle("Seek video to this segment"));

    // Hearing the line is how an editor checks it; reading the Arabic alone
    // cannot tell them what was actually said.
    expect(onSeek).toHaveBeenCalledWith("seg-1");
  });
});

describe("offering the AI nudges", () => {
  it("offers to fix a line the recogniser was unsure of", () => {
    render({ segment: aSegment({ confidence: 0.5 }), onFixArabic: vi.fn() });

    expect(screen.getByTitle("AI Fix Arabic")).toBeInTheDocument();
  });

  it("stays quiet on a line the recogniser was confident about", () => {
    render({ segment: aSegment({ confidence: 0.95 }), onFixArabic: vi.fn() });

    // A fix button on every line invites rewriting text that was already
    // right, and an editor reviewing four hundred of them learns to click it.
    expect(screen.queryByTitle("AI Fix Arabic")).not.toBeInTheDocument();
  });

  it("offers to re-translate only when the Arabic has moved on", () => {
    const { rerender, ...handlers } = render({
      onRetranslate: vi.fn(),
      isStaleTranslation: false,
    });
    expect(screen.queryByTitle("Re-translate")).not.toBeInTheDocument();

    rerender(
      <SegmentCard
        segment={aSegment()}
        index={0}
        isStaleTranslation
        onRetranslate={handlers.onSeek}
        onSplit={handlers.onSplit}
        onSplitAtCursor={handlers.onSplitAtCursor}
        onEditText={handlers.onEditText}
        onEditTranslation={handlers.onEditTranslation}
        onStartChange={handlers.onStartChange}
        onEndChange={handlers.onEndChange}
      />,
    );

    // A re-translation of unchanged Arabic is a paid call that returns what is
    // already on screen.
    expect(screen.getByTitle("Re-translate")).toBeInTheDocument();
  });

  it("marks a translation that no longer matches its Arabic", () => {
    render({ isStaleTranslation: true });

    // The dot is the only thing standing between an edited line and a subtitle
    // whose English describes the sentence that used to be there.
    expect(screen.getByTitle("Translation may be stale")).toBeInTheDocument();
  });
});

describe("editing the Arabic", () => {
  it("opens on a click and starts from what is there", () => {
    render();

    startEditing();

    expect(arabicBox()).toHaveValue("شلونك اليوم");
  });

  it("saves on blur", () => {
    const { onEditText } = render();
    startEditing();

    fireEvent.change(arabicBox(), { target: { value: "شخبارك اليوم" } });
    fireEvent.blur(arabicBox());

    expect(onEditText).toHaveBeenCalledWith("seg-1", "شخبارك اليوم");
  });

  it("saves on the keyboard without leaving the field", () => {
    const { onEditText } = render();
    startEditing();

    fireEvent.change(arabicBox(), { target: { value: "شخبارك" } });
    fireEvent.keyDown(arabicBox(), { key: "Enter", metaKey: true });

    // Reaching for a mouse between every line is most of the cost of editing a
    // four-hundred-line transcript.
    expect(onEditText).toHaveBeenCalledWith("seg-1", "شخبارك");
  });

  it("abandons the edit on Escape", () => {
    const { onEditText } = render();
    startEditing();
    fireEvent.change(arabicBox(), { target: { value: "wrong" } });

    fireEvent.keyDown(arabicBox(), { key: "Escape" });

    // Undo exists, but not needing it is better — an editor who mistyped wants
    // the line back, not an entry on a stack.
    expect(onEditText).not.toHaveBeenCalled();
    expect(screen.getByText("شلونك")).toBeInTheDocument();
  });

  it("writes nothing when the text did not change", () => {
    const { onEditText } = render();
    startEditing();

    fireEvent.blur(arabicBox());

    // Tabbing through a transcript to read it must not mark every line edited,
    // or every line's translation goes stale.
    expect(onEditText).not.toHaveBeenCalled();
  });

  it("trims what it saves", () => {
    const { onEditText } = render();
    startEditing();

    fireEvent.change(arabicBox(), { target: { value: "  شخبارك  " } });
    fireEvent.blur(arabicBox());

    // A leading space is a visible indent in a subtitle.
    expect(onEditText).toHaveBeenCalledWith("seg-1", "شخبارك");
  });
});

describe("splitting a line", () => {
  it("splits at the cursor on Enter", () => {
    const { onSplitAtCursor } = render();
    startEditing();
    const box = arabicBox();

    fireEvent.change(box, { target: { value: "شلونك اليوم" } });
    box.setSelectionRange(6, 6);
    fireEvent.keyDown(box, { key: "Enter" });

    // Deciding a line is two lines happens while reading it, so the split is
    // where the cursor already is rather than a separate gesture.
    expect(onSplitAtCursor).toHaveBeenCalledWith("seg-1", 6, "شلونك اليوم");
  });

  it("refuses a split that would leave one side empty", () => {
    const { onSplitAtCursor } = render();
    startEditing();
    const box = arabicBox();

    box.setSelectionRange(0, 0);
    fireEvent.keyDown(box, { key: "Enter" });

    // A zero-length segment renders as a subtitle that flashes and says
    // nothing, and it holds a timestamp range the next line needs.
    expect(onSplitAtCursor).not.toHaveBeenCalled();
  });

  it("keeps Enter for splitting rather than for a newline", () => {
    const { onEditText, onSplitAtCursor } = render();
    startEditing();
    const box = arabicBox();
    box.setSelectionRange(6, 6);

    fireEvent.keyDown(box, { key: "Enter" });

    // A subtitle is one line by definition; a newline inside one is invisible
    // in the player and breaks the SRT on export.
    expect(onSplitAtCursor).toHaveBeenCalled();
    expect(onEditText).not.toHaveBeenCalled();
  });
});

describe("editing the translation", () => {
  it("opens on a click and starts from what is there", () => {
    render();

    fireEvent.click(screen.getByTitle("Click to edit translation"));

    expect(screen.getByRole("textbox")).toHaveValue("how are you today");
  });

  it("saves on blur", () => {
    const { onEditTranslation } = render();
    fireEvent.click(screen.getByTitle("Click to edit translation"));

    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "how's it going today" } });
    fireEvent.blur(box);

    expect(onEditTranslation).toHaveBeenCalledWith("seg-1", "how's it going today");
  });

  it("abandons on Escape", () => {
    const { onEditTranslation } = render();
    fireEvent.click(screen.getByTitle("Click to edit translation"));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "wrong" } });

    fireEvent.keyDown(box, { key: "Escape" });

    expect(onEditTranslation).not.toHaveBeenCalled();
    expect(screen.getByText("how are you today")).toBeInTheDocument();
  });

  it("writes nothing when the translation did not change", () => {
    const { onEditTranslation } = render();
    fireEvent.click(screen.getByTitle("Click to edit translation"));

    fireEvent.blur(screen.getByRole("textbox"));

    expect(onEditTranslation).not.toHaveBeenCalled();
  });

  it("accepts a translation for a line that had none", () => {
    const { onEditTranslation } = render({ segment: aSegment({ translation: "" }) });
    fireEvent.click(screen.getByTitle("Click to edit translation"));

    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "how are you today" } });
    fireEvent.blur(box);

    expect(onEditTranslation).toHaveBeenCalledWith("seg-1", "how are you today");
  });
});

describe("marking the active line", () => {
  it("stands out while it is being spoken", () => {
    const { container } = render({ isActive: true });

    // The transcript scrolls with the video; without a marked line the editor
    // has to find their place again after every seek.
    expect(container.querySelector("[data-segment-id='seg-1']")?.className).toContain("border-blue");
  });

  it("sits quietly when it is not", () => {
    const { container } = render({ isActive: false });

    expect(container.querySelector("[data-segment-id='seg-1']")?.className).not.toContain(
      "border-blue",
    );
  });
});
