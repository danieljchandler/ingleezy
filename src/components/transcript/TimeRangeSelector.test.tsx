import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeRangeSelector } from "./TimeRangeSelector";

/**
 * The "which part of this should we transcribe?" slider.
 *
 * Transcription is metered and slow, so a learner uploading a forty-minute
 * podcast is asked to pick the three minutes they actually want. The cap is the
 * whole point of the control: the two handles can be dragged anywhere, but the
 * distance between them is clamped so a selection can never exceed what the
 * pipeline will accept — which is more useful than refusing the job afterwards.
 *
 * Radix's slider is driven with the keyboard here. Pointer dragging needs real
 * geometry, which jsdom does not have, but the arrow keys go through exactly
 * the same `onValueChange` path.
 */

interface Options {
  duration?: number;
  maxRange?: number;
  value?: [number, number];
}

function renderSelector({ duration = 600, maxRange, value }: Options = {}) {
  const onChange = vi.fn();
  const result = render(
    <TimeRangeSelector
      duration={duration}
      maxRange={maxRange}
      onChange={onChange}
      value={value}
    />,
  );
  return { ...result, onChange };
}

const handles = () => screen.getAllByRole("slider");
/**
 * Nudge a handle one step, the way a keyboard user would.
 *
 * The focus matters: Radix listens for the key on the root and works out which
 * value to change from whichever thumb last took focus. Without it every arrow
 * key moves the first handle, whichever one the event was dispatched on.
 */
const nudge = (which: 0 | 1, key: "ArrowRight" | "ArrowLeft", times = 1) => {
  for (let i = 0; i < times; i++) {
    const thumb = handles()[which];
    fireEvent.focus(thumb);
    fireEvent.keyDown(thumb, { key });
  }
};

describe("TimeRangeSelector — what it starts on", () => {
  it("selects from the beginning up to the cap", () => {
    renderSelector({ duration: 600, maxRange: 180 });
    expect(handles()[0]).toHaveAttribute("aria-valuenow", "0");
    expect(handles()[1]).toHaveAttribute("aria-valuenow", "180");
  });

  it("selects the whole clip when it is shorter than the cap", () => {
    renderSelector({ duration: 45, maxRange: 180 });
    expect(handles()[1]).toHaveAttribute("aria-valuenow", "45");
  });

  it("defaults the cap to three minutes", () => {
    renderSelector({ duration: 600 });
    expect(handles()[1]).toHaveAttribute("aria-valuenow", "180");
  });

  it("shows the selected length against the cap", () => {
    renderSelector({ duration: 600, maxRange: 180 });
    expect(screen.getByText("3:00 / 3:00 max")).toBeInTheDocument();
  });

  it("shows both ends of the selection and the clip's full length", () => {
    renderSelector({ duration: 600, maxRange: 180 });
    expect(screen.getByText("0:00 – 3:00")).toBeInTheDocument();
    expect(screen.getByText("10:00")).toBeInTheDocument();
  });

  it("pads the seconds", () => {
    renderSelector({ duration: 65, maxRange: 180 });
    expect(screen.getByText("0:00 – 1:05")).toBeInTheDocument();
  });

  it("rounds a fractional duration down rather than showing 1:60", () => {
    renderSelector({ duration: 59.9, maxRange: 180 });
    expect(screen.getByText("0:59")).toBeInTheDocument();
  });

  it("stays left-to-right inside an Arabic page", () => {
    // The transcription screen can be rendered under dir="rtl"; a mirrored
    // timeline would put the end of the clip on the left.
    const { container } = renderSelector();
    expect(container.firstChild).toHaveAttribute("dir", "ltr");
  });

  it("honours a starting range the caller supplies", () => {
    renderSelector({ duration: 600, value: [60, 120] });
    expect(handles()[0]).toHaveAttribute("aria-valuenow", "60");
    expect(handles()[1]).toHaveAttribute("aria-valuenow", "120");
  });

  it("reports the range it picked for itself", () => {
    // Picking [0, effectiveMax] silently left the parent's idea of the range at
    // whatever it initialised itself with: a parent starting at [0, 0] and
    // submitting untouched sent an empty range while the screen showed three
    // minutes selected.
    const { onChange } = renderSelector({ duration: 600 });
    expect(onChange).toHaveBeenCalledWith([0, 180]);
  });

  it("reports the whole clip when it is shorter than the cap", () => {
    const { onChange } = renderSelector({ duration: 45, maxRange: 180 });
    expect(onChange).toHaveBeenCalledWith([0, 45]);
  });

  it("stays quiet when the caller already has a range", () => {
    // Nothing was chosen on the caller's behalf, so there is nothing to report.
    const { onChange } = renderSelector({ duration: 600, value: [60, 120] });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports again when the duration arrives late", () => {
    // The transcription screen probes the media after mounting the selector.
    const { rerender, onChange } = renderSelector({ duration: 0 });
    onChange.mockClear();
    rerender(<TimeRangeSelector duration={600} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith([0, 180]);
  });

  it("caps the readout at the length of the clip", () => {
    // "0:45 / 3:00 max" read as an invitation to select two and a quarter
    // minutes that do not exist.
    renderSelector({ duration: 45, maxRange: 180 });
    expect(screen.getByText("0:45 / 0:45 max")).toBeInTheDocument();
  });

  it("still shows the configured cap when the clip is longer", () => {
    renderSelector({ duration: 600, maxRange: 180 });
    expect(screen.getByText("3:00 / 3:00 max")).toBeInTheDocument();
  });

  it("takes a new range when the caller supplies one", () => {
    // `useState(value || …)` read the prop once and never again, so a screen
    // that revised the range after probing the media disagreed with its own
    // slider about what would be processed.
    const { rerender, onChange } = renderSelector({ duration: 600, value: [0, 60] });
    rerender(
      <TimeRangeSelector duration={600} onChange={onChange} value={[120, 240]} />,
    );
    expect(handles()[0]).toHaveAttribute("aria-valuenow", "120");
    expect(handles()[1]).toHaveAttribute("aria-valuenow", "240");
  });

  it("does not echo the caller's own range back at it", () => {
    // Following the prop must not look like a user edit, or a controlled parent
    // would loop.
    const { rerender, onChange } = renderSelector({ duration: 600, value: [0, 60] });
    rerender(
      <TimeRangeSelector duration={600} onChange={onChange} value={[120, 240]} />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TimeRangeSelector — moving the handles", () => {
  it("reports a moved start handle", () => {
    const { onChange } = renderSelector({ duration: 600, value: [10, 100] });
    nudge(0, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith([11, 100]);
  });

  it("reports a moved end handle", () => {
    const { onChange } = renderSelector({ duration: 600, value: [10, 100] });
    nudge(1, "ArrowLeft");
    expect(onChange).toHaveBeenLastCalledWith([10, 99]);
  });

  it("updates the readout as the selection changes", () => {
    renderSelector({ duration: 600, value: [0, 60] });
    nudge(1, "ArrowRight", 5);
    expect(screen.getByText("0:00 – 1:05")).toBeInTheDocument();
    expect(screen.getByText("1:05 / 3:00 max")).toBeInTheDocument();
  });

  it("will not let the start pass zero", () => {
    const { onChange } = renderSelector({ duration: 600, value: [0, 100] });
    nudge(0, "ArrowLeft");
    // Radix stops at the slider minimum, so nothing is reported at all.
    expect(onChange.mock.calls.every(([r]) => r[0] >= 0)).toBe(true);
  });

  it("will not let the end pass the clip", () => {
    const { onChange } = renderSelector({ duration: 100, value: [0, 100] });
    nudge(1, "ArrowRight");
    expect(onChange.mock.calls.every(([r]) => r[1] <= 100)).toBe(true);
  });
});

describe("TimeRangeSelector — holding the selection inside the cap", () => {
  it("refuses to move the end past the cap", () => {
    // The handle being dragged is the one that gives way: `end` is snapped back
    // to `start + maxRange`, leaving the window exactly where it was. Refusing
    // the drag rather than sliding the whole window means a learner never loses
    // the start they had already chosen.
    const { onChange } = renderSelector({ duration: 600, maxRange: 60, value: [0, 60] });
    nudge(1, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith([0, 60]);
  });

  it("keeps the window at exactly the cap while the end is dragged out", () => {
    const { onChange } = renderSelector({ duration: 600, maxRange: 60, value: [0, 60] });
    nudge(1, "ArrowRight", 10);
    const [start, end] = onChange.mock.calls.at(-1)![0];
    expect(end - start).toBe(60);
  });

  it("refuses to move the start past the cap in the other direction", () => {
    const { onChange } = renderSelector({ duration: 600, maxRange: 60, value: [100, 160] });
    nudge(0, "ArrowLeft");
    expect(onChange).toHaveBeenLastCalledWith([100, 160]);
  });

  it("lets a full-length window be walked along one handle at a time", () => {
    // Shrink from the left, then grow on the right. This is how a learner
    // reaches minutes 10–13 of a long recording, and it works because each
    // individual step keeps the window inside the cap.
    const { onChange } = renderSelector({ duration: 600, maxRange: 60, value: [0, 60] });
    nudge(0, "ArrowRight", 5);
    nudge(1, "ArrowRight", 5);
    expect(onChange).toHaveBeenLastCalledWith([5, 65]);
  });

  it("leaves a selection under the cap alone", () => {
    const { onChange } = renderSelector({ duration: 600, maxRange: 180, value: [0, 30] });
    nudge(1, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith([0, 31]);
  });

  it("never reports a window longer than the cap", () => {
    const { onChange } = renderSelector({ duration: 600, maxRange: 45, value: [0, 45] });
    nudge(1, "ArrowRight", 20);
    nudge(0, "ArrowLeft", 20);
    for (const [[start, end]] of onChange.mock.calls) {
      expect(end - start).toBeLessThanOrEqual(45);
    }
  });
});
