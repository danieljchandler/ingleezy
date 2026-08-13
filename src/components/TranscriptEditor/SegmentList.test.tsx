import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Segment } from "@/types/transcript";
import SegmentList from "./SegmentList";

/**
 * The stack of segment cards in the transcript editor, and the dividers between
 * them.
 *
 * The cards themselves are covered by SegmentCard.test.tsx; what lives here is
 * everything that only makes sense in the context of neighbours. The gap
 * readout between two segments is the editor's main quality signal — an
 * overlap means two lines claim the same audio and the player will fight
 * itself, and a long silence usually means a line was dropped — so the divider
 * shows the number always rather than hiding it behind a check, and shouts
 * only when it is worth shouting about.
 */

interface CardProps {
  segment: Segment;
  index: number;
  isActive: boolean;
  activeWordIndex: number;
  isStaleTranslation: boolean;
  prevSegmentEnd?: number;
  nextSegmentStart?: number;
}
const cards = vi.hoisted(() => ({ rendered: [] as CardProps[] }));

vi.mock("./SegmentCard", () => ({
  default: (props: CardProps) => {
    cards.rendered.push(props);
    return (
      <div data-segment-id={props.segment.id} data-testid="card">
        {props.segment.text}
      </div>
    );
  },
}));

const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;

beforeEach(() => {
  cards.rendered = [];
  scrollIntoView.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

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

/** Three segments with a clean 0.5s gap between each. */
const threeSegments = (): Segment[] => [
  aSegment({ id: "s1", start: 0, end: 1, text: "one" }),
  aSegment({ id: "s2", start: 1.5, end: 2.5, text: "two" }),
  aSegment({ id: "s3", start: 3, end: 4, text: "three" }),
];

interface Options {
  segments?: Segment[];
  activeSegmentId?: string | null;
  activeWordIndex?: number;
  stale?: string[];
}

const handlers = () => ({
  onSplit: vi.fn(),
  onSplitAtCursor: vi.fn(),
  onMerge: vi.fn(),
  onEditText: vi.fn(),
  onEditTranslation: vi.fn(),
  onStartChange: vi.fn(),
  onEndChange: vi.fn(),
  onFixArabic: vi.fn(),
  onRetranslate: vi.fn(),
  onSeek: vi.fn(),
});

function renderList({
  segments = threeSegments(),
  activeSegmentId = null,
  activeWordIndex = 0,
  stale = [],
}: Options = {}) {
  const h = handlers();
  const result = render(
    <SegmentList
      segments={segments}
      activeSegmentId={activeSegmentId}
      activeWordIndex={activeWordIndex}
      staleTranslations={new Set(stale)}
      {...h}
    />,
  );
  return { ...result, ...h };
}

/** The card props for a given segment id, from its most recent render. */
const propsFor = (id: string) => cards.rendered.filter((c) => c.segment.id === id).at(-1)!;

describe("SegmentList — laying out the cards", () => {
  it("renders one card per segment, in order", () => {
    renderList();
    expect(screen.getAllByTestId("card").map((el) => el.textContent)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("numbers the cards from the top", () => {
    renderList();
    expect(propsFor("s2").index).toBe(1);
  });

  it("renders nothing for an empty transcript", () => {
    const { container } = renderList({ segments: [] });
    expect(screen.queryAllByTestId("card")).toEqual([]);
    expect(container.querySelector("button")).toBeNull();
  });

  it("marks only the active card as active", () => {
    renderList({ activeSegmentId: "s2" });
    expect(propsFor("s1").isActive).toBe(false);
    expect(propsFor("s2").isActive).toBe(true);
  });

  it("gives the word cursor only to the active card", () => {
    // A word index means "this word is being spoken now". Handing it to every
    // card would highlight the same position in all of them at once.
    renderList({ activeSegmentId: "s2", activeWordIndex: 3 });
    expect(propsFor("s2").activeWordIndex).toBe(3);
    expect(propsFor("s1").activeWordIndex).toBe(-1);
  });

  it("marks the segments whose translation has gone stale", () => {
    renderList({ stale: ["s3"] });
    expect(propsFor("s3").isStaleTranslation).toBe(true);
    expect(propsFor("s1").isStaleTranslation).toBe(false);
  });
});

describe("SegmentList — telling a card about its neighbours", () => {
  it("gives each card the end of the one before it", () => {
    // The card uses this to stop a timestamp drag crossing into the previous
    // segment, which is the commonest way an editor creates an overlap.
    renderList();
    expect(propsFor("s2").prevSegmentEnd).toBe(1);
  });

  it("gives each card the start of the one after it", () => {
    renderList();
    expect(propsFor("s2").nextSegmentStart).toBe(3);
  });

  it("leaves the first card with no previous neighbour", () => {
    renderList();
    expect(propsFor("s1").prevSegmentEnd).toBeUndefined();
  });

  it("leaves the last card with no next neighbour", () => {
    renderList();
    expect(propsFor("s3").nextSegmentStart).toBeUndefined();
  });

  it("gives a lone card neither", () => {
    renderList({ segments: [aSegment()] });
    expect(propsFor("s1").prevSegmentEnd).toBeUndefined();
    expect(propsFor("s1").nextSegmentStart).toBeUndefined();
  });
});

describe("SegmentList — the gap between two segments", () => {
  const gapBetween = (endOfFirst: number, startOfSecond: number) =>
    renderList({
      segments: [
        aSegment({ id: "s1", start: 0, end: endOfFirst }),
        aSegment({ id: "s2", start: startOfSecond, end: startOfSecond + 1 }),
      ],
    });

  it("appears between every pair and after none", () => {
    renderList();
    expect(screen.getAllByRole("button", { name: "Merge ↕" })).toHaveLength(2);
  });

  it("reports an ordinary gap to the centisecond", () => {
    gapBetween(1, 1.5);
    expect(screen.getByText("gap 0.50s")).toBeInTheDocument();
  });

  it("flags a gap long enough to be a dropped line", () => {
    // Two seconds of silence inside speech is almost always a line the ASR
    // missed rather than a real pause.
    gapBetween(1, 4);
    expect(screen.getByText("gap 3.00s ⚠")).toBeInTheDocument();
  });

  it("leaves a two-second gap unflagged", () => {
    gapBetween(1, 3);
    expect(screen.getByText("gap 2.00s")).toBeInTheDocument();
  });

  it("calls an overlap what it is", () => {
    gapBetween(2, 1.4);
    expect(screen.getByText("⚠ overlap 0.60s")).toBeInTheDocument();
  });

  it("reports touching segments as a zero gap", () => {
    gapBetween(1.5, 1.5);
    expect(screen.getByText("gap 0.00s")).toBeInTheDocument();
  });

  it("colours an overlap red and a long gap amber", () => {
    const { container, unmount } = gapBetween(2, 1.4);
    expect(container.querySelector(".text-red-600")).toBeInTheDocument();
    unmount();

    const second = gapBetween(1, 4);
    expect(second.container.querySelector(".text-amber-600")).toBeInTheDocument();
  });

  it("says nothing about an overlap of zero", () => {
    // 0.1 + 0.2 is 0.30000000000000004, so this pair is "touching" by intent
    // and 5.5e-17 apart in fact. An exact `gap < 0` called that an overlap and
    // announced "⚠ overlap 0.00s" — an alarm about a defect whose own reported
    // size is zero, and one that a transcript from the AI re-segmentation path
    // is full of.
    const { container } = gapBetween(0.1 + 0.2, 0.3);
    expect(screen.queryByText(/overlap/)).not.toBeInTheDocument();
    expect(screen.getByText("gap 0.00s")).toBeInTheDocument();
    expect(container.querySelector(".text-red-600")).toBeNull();
  });

  it("still reports an overlap big enough to hear", () => {
    // A millisecond is below anything the editor can express; a tenth of a
    // second is a real defect and still has to show.
    const { container } = gapBetween(1.0, 0.9);
    expect(screen.getByText("⚠ overlap 0.10s")).toBeInTheDocument();
    expect(container.querySelector(".text-red-600")).toBeInTheDocument();
  });
});

describe("SegmentList — merging", () => {
  it("names the two lines it would join", () => {
    // One-based in the title because the cards are numbered that way on screen.
    renderList();
    expect(screen.getByTitle("Merge segments 1 and 2")).toBeInTheDocument();
    expect(screen.getByTitle("Merge segments 2 and 3")).toBeInTheDocument();
  });

  it("merges at the divider that was pressed", () => {
    const { onMerge } = renderList();
    fireEvent.click(screen.getByTitle("Merge segments 2 and 3"));
    expect(onMerge).toHaveBeenCalledWith(1);
  });

  it("offers no merge on a single segment", () => {
    renderList({ segments: [aSegment()] });
    expect(screen.queryByRole("button", { name: "Merge ↕" })).not.toBeInTheDocument();
  });
});

describe("SegmentList — following the playhead", () => {
  it("brings the active segment into view", () => {
    renderList({ activeSegmentId: "s3" });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("scrolls as little as it can", () => {
    // `nearest` keeps a segment that is already visible where it is, so the
    // list does not jerk on every word boundary during playback.
    renderList({ activeSegmentId: "s3" });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("does not scroll when nothing is playing", () => {
    renderList();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls again when the playhead moves to another segment", () => {
    const { rerender, ...h } = renderList({ activeSegmentId: "s1" });
    rerender(
      <SegmentList
        segments={threeSegments()}
        activeSegmentId="s2"
        activeWordIndex={0}
        staleTranslations={new Set()}
        {...h}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does not scroll when only the word within a segment advances", () => {
    // Otherwise every word of a long line would re-scroll the list.
    const { rerender, ...h } = renderList({ activeSegmentId: "s1", activeWordIndex: 0 });
    rerender(
      <SegmentList
        segments={threeSegments()}
        activeSegmentId="s1"
        activeWordIndex={4}
        staleTranslations={new Set()}
        {...h}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("SegmentList — passing the editing handlers down", () => {
  it("hands every card the same set of callbacks", () => {
    const { onSplit, onEditText, onSeek } = renderList();
    const card = cards.rendered.at(-1) as unknown as Record<string, unknown>;
    expect(card.onSplit).toBe(onSplit);
    expect(card.onEditText).toBe(onEditText);
    expect(card.onSeek).toBe(onSeek);
  });

  it("passes the optional ones through as undefined when absent", () => {
    // SegmentCard hides Fix Arabic and Retranslate when it has no handler, so
    // an omitted prop has to stay omitted rather than becoming a no-op.
    render(
      <SegmentList
        segments={[aSegment()]}
        staleTranslations={new Set()}
        onSplit={vi.fn()}
        onSplitAtCursor={vi.fn()}
        onMerge={vi.fn()}
        onEditText={vi.fn()}
        onEditTranslation={vi.fn()}
        onStartChange={vi.fn()}
        onEndChange={vi.fn()}
      />,
    );
    const card = cards.rendered.at(-1) as unknown as Record<string, unknown>;
    expect(card.onFixArabic).toBeUndefined();
    expect(card.onRetranslate).toBeUndefined();
    expect(card.onSeek).toBeUndefined();
  });
});
