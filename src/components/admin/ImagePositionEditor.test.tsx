import { act, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagePositionEditor } from "./ImagePositionEditor";

/**
 * Choosing which part of a picture a flashcard shows.
 *
 * Cards are square-ish and stock photography is not, so `object-cover` throws
 * away a third of every image. Which third is the difference between a picture
 * of an apple and a picture of a table with an apple somewhere on it — and the
 * word being taught is usually not in the middle of the frame.
 *
 * The control is a drag on a live preview rather than two number fields,
 * because the admin is judging the result, not the coordinates.
 */

const BOX = { left: 100, top: 50, width: 200, height: 150 };

let cleanup: (() => void) | undefined;

beforeEach(() => {
  // jsdom gives every element a zero-sized rect, and the editor converts a
  // pointer position into a percentage by dividing by the box's size.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    ...BOX,
    right: BOX.left + BOX.width,
    bottom: BOX.top + BOX.height,
    x: BOX.left,
    y: BOX.top,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

function render({ position = "50 50" }: { position?: string } = {}) {
  const onPositionChange = vi.fn();
  const view = rtlRender(
    <ImagePositionEditor
      imageUrl="https://images.test/apple.png"
      position={position}
      onPositionChange={onPositionChange}
    />,
  );
  cleanup = view.unmount;
  return { ...view, onPositionChange };
}

const preview = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".cursor-crosshair")!;
const image = (container: HTMLElement) => container.querySelector("img")!;

/** A point inside the box, given as a fraction of its width and height. */
const at = (fx: number, fy: number) => ({
  clientX: BOX.left + BOX.width * fx,
  clientY: BOX.top + BOX.height * fy,
});

describe("showing the crop", () => {
  it("previews the picture as the card will crop it", () => {
    const { container } = render({ position: "30 70" });

    // The preview is 4:3 and uses object-cover, which is exactly what the card
    // does — the point is that what the admin sees is what ships.
    expect(image(container)).toHaveAttribute("src", "https://images.test/apple.png");
    expect(image(container).style.objectPosition).toBe("30% 70%");
    expect(preview(container).className).toContain("aspect-[4/3]");
  });

  it("marks the focal point and crosses it", () => {
    const { container } = render({ position: "30 70" });

    // The dot alone is hard to line up against a subject; the crosshairs are
    // what make "the cat's eye" a placeable target.
    const dot = container.querySelector<HTMLElement>(".rounded-full.border-2")!;
    expect(dot.style.left).toBe("30%");
    expect(dot.style.top).toBe("70%");
    expect(container.querySelectorAll(".bg-primary\\/40")).toHaveLength(2);
  });

  it("says the numbers as well as showing them", () => {
    render({ position: "30 70" });

    // Two cards cropped the same way is a matter of typing the same numbers,
    // which needs the numbers to be readable.
    expect(screen.getByText("Position: 30% horizontal, 70% vertical")).toBeInTheDocument();
  });

  it("says what to do", () => {
    render();

    expect(screen.getByText("Drag to set image focal point")).toBeInTheDocument();
  });

  it("does not let the browser drag the image away", () => {
    const { container } = render();

    // Without this, a drag starts the browser's own image-drag and the editor
    // never sees the move.
    expect(image(container)).toHaveAttribute("draggable", "false");
    expect(image(container).className).toContain("pointer-events-none");
  });
});

describe("dragging the focal point", () => {
  it("takes the point that was pressed", () => {
    const { container, onPositionChange } = render();

    fireEvent.mouseDown(preview(container), at(0.25, 0.5));

    // A press is a placement, not just the start of a drag — clicking the
    // subject is the fastest way to do this and should not need a wiggle.
    expect(onPositionChange).toHaveBeenCalledWith("25 50");
  });

  it("follows the mouse across the box", () => {
    const { container, onPositionChange } = render();
    fireEvent.mouseDown(preview(container), at(0.25, 0.5));

    fireEvent.mouseMove(window, at(0.75, 0.2));

    expect(onPositionChange).toHaveBeenLastCalledWith("75 20");
  });

  it("keeps following outside the box until the button is let go", () => {
    const { container, onPositionChange } = render();
    fireEvent.mouseDown(preview(container), at(0.5, 0.5));

    fireEvent.mouseMove(window, { clientX: BOX.left - 500, clientY: BOX.top - 500 });

    // Overshooting the small preview is normal. Clamping rather than dropping
    // the drag means the pointer stays glued to the edge it is heading for.
    expect(onPositionChange).toHaveBeenLastCalledWith("0 0");
  });

  it("clamps to the far corner too", () => {
    const { container, onPositionChange } = render();
    fireEvent.mouseDown(preview(container), at(0.5, 0.5));

    fireEvent.mouseMove(window, { clientX: BOX.left + 9999, clientY: BOX.top + 9999 });

    expect(onPositionChange).toHaveBeenLastCalledWith("100 100");
  });

  it("stops following once the button is released", () => {
    const { container, onPositionChange } = render();
    fireEvent.mouseDown(preview(container), at(0.5, 0.5));
    fireEvent.mouseUp(window);
    onPositionChange.mockClear();

    fireEvent.mouseMove(window, at(0.1, 0.1));

    // The listener is on the window; leaving it attached would move the focal
    // point every time the admin's mouse crossed the form.
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it("rounds to whole percentages", () => {
    const { container, onPositionChange } = render();

    fireEvent.mouseDown(preview(container), { clientX: BOX.left + 77, clientY: BOX.top + 33 });

    // The value is stored as a string and read back by two components; a long
    // decimal would round-trip differently each time.
    const [x, y] = onPositionChange.mock.calls[0][0].split(" ").map(Number);
    expect(Number.isInteger(x)).toBe(true);
    expect(Number.isInteger(y)).toBe(true);
  });

  it("shows that a drag is under way", () => {
    const { container } = render();

    fireEvent.mouseDown(preview(container), at(0.5, 0.5));

    expect(preview(container).className).toContain("border-primary");
    expect(container.querySelector(".scale-110")).not.toBeNull();
  });

  it("goes back to resting when the drag ends", () => {
    const { container } = render();
    fireEvent.mouseDown(preview(container), at(0.5, 0.5));

    fireEvent.mouseUp(window);

    expect(preview(container).className).toContain("border-muted-foreground/25");
    expect(container.querySelector(".scale-110")).toBeNull();
  });

  it("does not move on a stray mouse move before any press", () => {
    const { container, onPositionChange } = render();

    fireEvent.mouseMove(window, at(0.1, 0.1));

    expect(onPositionChange).not.toHaveBeenCalled();
    expect(container).toBeTruthy();
  });

  it("stops listening when the editor closes mid-drag", () => {
    const { container, onPositionChange } = render();
    fireEvent.mouseDown(preview(container), at(0.5, 0.5));

    act(() => {
      cleanup!();
      cleanup = undefined;
    });
    onPositionChange.mockClear();
    fireEvent.mouseMove(window, at(0.1, 0.1));

    // The form this sits in is a dialog that can be closed mid-drag.
    expect(onPositionChange).not.toHaveBeenCalled();
  });
});

describe("dragging on a touchscreen", () => {
  it("takes the point that was touched", () => {
    const { container, onPositionChange } = render();

    fireEvent.touchStart(preview(container), { touches: [at(0.25, 0.5)] });

    // Curation happens on a phone as often as not, and a mouse-only control
    // would be unusable there.
    expect(onPositionChange).toHaveBeenCalledWith("25 50");
  });

  it("follows the finger", () => {
    const { container, onPositionChange } = render();
    fireEvent.touchStart(preview(container), { touches: [at(0.25, 0.5)] });

    fireEvent.touchMove(window, { touches: [at(0.75, 0.2)] });

    expect(onPositionChange).toHaveBeenLastCalledWith("75 20");
  });

  it("stops when the finger lifts", () => {
    const { container, onPositionChange } = render();
    fireEvent.touchStart(preview(container), { touches: [at(0.5, 0.5)] });
    fireEvent.touchEnd(window);
    onPositionChange.mockClear();

    fireEvent.touchMove(window, { touches: [at(0.1, 0.1)] });

    expect(onPositionChange).not.toHaveBeenCalled();
  });
});

describe("the presets", () => {
  it.each([
    ["Center", "50 50"],
    ["Top", "50 25"],
    ["Bottom", "50 75"],
  ])("puts the focal point at %s", (label, expected) => {
    const { onPositionChange } = render({ position: "10 90" });

    fireEvent.click(screen.getByRole("button", { name: label }));

    // Most pictures want one of these three, and a preset is faster and more
    // repeatable than aiming at a thumbnail.
    expect(onPositionChange).toHaveBeenCalledWith(expected);
  });

  it("shows which preset the current position matches", () => {
    render({ position: "50 25" });

    expect(screen.getByRole("button", { name: "Top" }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Center" }).className).not.toContain("bg-primary");
  });

  it("highlights nothing when the position was dragged by hand", () => {
    render({ position: "37 62" });

    for (const label of ["Center", "Top", "Bottom"]) {
      expect(screen.getByRole("button", { name: label }).className).not.toContain("bg-primary");
    }
  });

  it("mis-parses a position with an extra space", () => {
    render({ position: "50  50" });

    // Pinned: the position is parsed with a bare `split(' ')`, so a double space
    // yields ["50", "", "50"] and the vertical coordinate is read from the empty
    // string — `Number("")` is 0, which is the top edge, not the centre. The
    // crop silently moves. The preset row disagrees separately: it compares the
    // raw string to "50 50" and lights nothing.
    expect(screen.getByText("Position: 50% horizontal, 0% vertical")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Center" }).className).not.toContain("bg-primary");
  });
});
