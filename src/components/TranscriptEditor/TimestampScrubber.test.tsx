import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import TimestampScrubber from "./TimestampScrubber";

/**
 * The drag bar under a transcript segment.
 *
 * Nudging a subtitle's in and out points is the most-repeated action in the
 * editor, and typing timestamps is far too slow for it — hence a bar with two
 * handles. The bar's own extent is the space the segment is allowed to occupy:
 * from the previous segment's end to the next one's start.
 *
 * When rippling is enabled a handle is supposed to be draggable *past* those
 * bounds, turning orange to say the neighbours will shift with it. As the tests
 * below record, that cannot actually be reached by dragging.
 */

const BAR_WIDTH = 200;

let cleanup: (() => void) | undefined;

beforeEach(() => {
  // jsdom gives every element a zero-sized rect, and the bar converts a pixel
  // position into a time by dividing by its width.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: BAR_WIDTH,
    bottom: 8,
    width: BAR_WIDTH,
    height: 8,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

interface Options {
  start?: number;
  end?: number;
  minStart?: number;
  maxEnd?: number;
  allowRipple?: boolean;
}

function render({
  start = 2,
  end = 4,
  minStart = 1,
  maxEnd = 6,
  allowRipple = false,
}: Options = {}) {
  const onStartChange = vi.fn();
  const onEndChange = vi.fn();
  const harness = renderWithProviders(
    <TimestampScrubber
      start={start}
      end={end}
      minStart={minStart}
      maxEnd={maxEnd}
      allowRipple={allowRipple}
      onStartChange={onStartChange}
      onEndChange={onEndChange}
    />,
    { persona: "admin" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onStartChange, onEndChange };
}

const handles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(".cursor-ew-resize"));

/** Drag a handle to a pixel position along the bar and let go. */
const drag = (handle: HTMLElement, clientX: number, { release = true } = {}) => {
  fireEvent.mouseDown(handle);
  fireEvent.mouseMove(window, { clientX });
  if (release) fireEvent.mouseUp(window);
};

describe("reading the segment", () => {
  it("shows where it starts, where it ends and how long it is", () => {
    render();

    expect(screen.getByText("00:02.00")).toBeInTheDocument();
    expect(screen.getByText("00:04.00")).toBeInTheDocument();
    expect(screen.getByText("2.00s")).toBeInTheDocument();
  });

  it("draws the segment inside the space it is allowed to occupy", () => {
    const { container } = render();

    // The bar spans the previous segment's end to the next one's start, so the
    // filled part shows at a glance how much room there is either side.
    const range = container.querySelector<HTMLElement>(".bg-blue-400\\/50")!;
    expect(range.style.left).toBe("20%");
    expect(range.style.width).toBe("40%");
  });
});

describe("dragging the start", () => {
  it("reports the time the handle was dropped at", () => {
    const { container, onStartChange } = render();

    // Half way along a bar spanning 1s–6s.
    drag(handles(container)[0], BAR_WIDTH / 2);

    expect(onStartChange).toHaveBeenLastCalledWith(3.5);
  });

  it("rounds to the millisecond", () => {
    const { container, onStartChange } = render();

    drag(handles(container)[0], 77);

    const value = onStartChange.mock.calls.at(-1)![0];
    expect(value).toBe(Math.round(value * 1000) / 1000);
  });

  it("will not push the start past the end", () => {
    const { container, onStartChange } = render();

    drag(handles(container)[0], BAR_WIDTH);

    // A segment with a start after its end is unplayable, and the editor has no
    // way to show it.
    expect(onStartChange).toHaveBeenLastCalledWith(3.9);
  });

  it("stays inside the previous segment's end", () => {
    const { container, onStartChange } = render();

    drag(handles(container)[0], -50);

    // The bar starts at the neighbour's boundary, so the far left of it *is*
    // the earliest allowed time.
    expect(onStartChange).toHaveBeenLastCalledWith(1);
  });
});

describe("dragging the end", () => {
  it("reports the time the handle was dropped at", () => {
    const { container, onEndChange } = render();

    drag(handles(container)[1], BAR_WIDTH / 2);

    expect(onEndChange).toHaveBeenLastCalledWith(3.5);
  });

  it("will not pull the end before the start", () => {
    const { container, onEndChange } = render();

    drag(handles(container)[1], 0);

    expect(onEndChange).toHaveBeenLastCalledWith(2.1);
  });

  it("stays inside the next segment's start", () => {
    const { container, onEndChange } = render();

    drag(handles(container)[1], BAR_WIDTH * 2);

    expect(onEndChange).toHaveBeenLastCalledWith(6);
  });
});

describe("while dragging", () => {
  it("shows the time being dragged to instead of the duration", () => {
    const { container } = render();

    drag(handles(container)[0], BAR_WIDTH / 2, { release: false });

    // The editor is watching the number, not the bar — it is matching a cut to
    // something they heard.
    expect(screen.getByText("00:03.50")).toBeInTheDocument();
    expect(screen.queryByText("2.00s")).toBeNull();
  });

  it("goes back to the duration once the handle is released", () => {
    const { container } = render();
    drag(handles(container)[0], BAR_WIDTH / 2, { release: false });

    fireEvent.mouseUp(window);

    expect(screen.getByText("2.00s")).toBeInTheDocument();
  });

  it("stops following the mouse after release", () => {
    const { container, onStartChange } = render();
    drag(handles(container)[0], BAR_WIDTH / 2);
    onStartChange.mockClear();

    fireEvent.mouseMove(window, { clientX: 10 });

    expect(onStartChange).not.toHaveBeenCalled();
  });
});

describe("rippling into the neighbours", () => {
  it("says on the handle that a drag will shift them", () => {
    const { container } = render({ allowRipple: true });

    // The only warning before an edit that changes segments the editor is not
    // looking at.
    expect(handles(container)[0].title).toBe("Drag to adjust start (will ripple neighbors)");
    expect(handles(container)[1].title).toBe("Drag to adjust end (will ripple neighbors)");
  });

  it("cannot actually be dragged into a ripple", () => {
    const { container, onStartChange, onEndChange } = render({ allowRipple: true });

    drag(handles(container)[0], -100, { release: false });
    const startAfter = onStartChange.mock.calls.at(-1)![0];
    fireEvent.mouseUp(window);
    drag(handles(container)[1], BAR_WIDTH * 3, { release: false });
    const endAfter = onEndChange.mock.calls.at(-1)![0];

    // Pinned: rippling lets a handle pass minStart/maxEnd, and the bar's own
    // extent is computed *from* minStart and maxEnd — so the furthest a handle
    // can be dragged is exactly the boundary it would need to cross. The orange
    // handle, the ↯ marker and the "neighbors will shift" hint are all
    // unreachable by dragging.
    expect(startAfter).toBe(1);
    expect(endAfter).toBe(6);
    expect(container.querySelector(".bg-orange-500")).toBeNull();
    expect(screen.queryByText(/ripple active/)).toBeNull();
  });

  it("shows the ripple when the segment already overlaps its neighbour", () => {
    // A segment whose start is already before the previous one's end — which is
    // exactly what the ripple tool exists to repair. Here the bar is wider than
    // the bounds, so the boundary is reachable.
    const { container } = render({ start: 1, end: 4, minStart: 3, allowRipple: true });

    drag(handles(container)[0], 0, { release: false });

    expect(container.querySelector(".bg-orange-500")).not.toBeNull();
    expect(screen.getByText(/ripple active — neighbors will shift/)).toBeInTheDocument();
  });

  it("drops the warning when the handle is released", () => {
    const { container } = render({ start: 1, end: 4, minStart: 3, allowRipple: true });
    drag(handles(container)[0], 0, { release: false });

    fireEvent.mouseUp(window);

    expect(screen.queryByText(/ripple active/)).toBeNull();
  });
});
