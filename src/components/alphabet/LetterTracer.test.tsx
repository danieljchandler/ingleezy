import { act, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LetterTracer } from "./LetterTracer";

/**
 * Tracing a letter with a finger.
 *
 * Writing Arabic is the half of the alphabet that reading practice cannot
 * teach, and the shape only sticks once the hand has made it. The exercise is
 * deliberately dataless — there are no authored stroke paths for the 28 letters.
 * Instead the target glyph is painted to an offscreen canvas and the learner's
 * ink is compared against its pixels, which is why it works for every letter,
 * including ones nobody has hand-authored a path for.
 *
 * The consequence is that "did they trace it?" is a coverage number, not a
 * sequence of correct strokes — so the things worth pinning here are the
 * threshold, the fact that completion fires once, and that resetting really
 * clears the ink rather than just the score.
 */

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/lib/uiPrefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uiPrefs")>()),
  prefersReducedMotion: () => motion.reduced,
}));

const SIZE = 320;

/**
 * A recording 2D context. jsdom has no canvas, and the component needs two
 * things from it: somewhere to put ink, and `getImageData` to compare that ink
 * against the guide glyph.
 *
 * `fillText` stands in for the glyph by filling a fixed 120×120 block rather
 * than rasterising a font — the component only ever asks whether a pixel is
 * part of the letter, so a known block makes the coverage arithmetic exact.
 */
const GLYPH = { x0: 100, x1: 220, y0: 100, y1: 220 };

class FakeContext {
  /** One alpha byte per pixel; 0 is transparent. */
  private alpha = new Uint8ClampedArray(SIZE * SIZE);
  private from: { x: number; y: number } | null = null;
  private to: { x: number; y: number } | null = null;

  fillStyle = "";
  strokeStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  lineWidth = 1;
  lineCap = "";
  lineJoin = "";

  clearRect() {
    this.alpha = new Uint8ClampedArray(SIZE * SIZE);
  }

  fillText() {
    this.fill(GLYPH.x0, GLYPH.y0, GLYPH.x1, GLYPH.y1);
  }

  beginPath() {
    this.from = null;
    this.to = null;
  }
  moveTo(x: number, y: number) {
    this.from = { x, y };
  }
  lineTo(x: number, y: number) {
    this.to = { x, y };
  }

  /** The segment's bounding box, grown by half the pen width — exact for the
   *  axis-aligned strokes these tests draw. */
  stroke() {
    if (!this.from || !this.to) return;
    const pad = this.lineWidth / 2;
    this.fill(
      Math.min(this.from.x, this.to.x) - pad,
      Math.min(this.from.y, this.to.y) - pad,
      Math.max(this.from.x, this.to.x) + pad,
      Math.max(this.from.y, this.to.y) + pad,
    );
  }

  getImageData() {
    const data = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let i = 0; i < this.alpha.length; i++) data[i * 4 + 3] = this.alpha[i];
    return { data };
  }

  /** How many pixels currently carry ink — the test's view of "is it blank?". */
  inked() {
    return this.alpha.reduce((n, a) => n + (a > 50 ? 1 : 0), 0);
  }

  private fill(x0: number, y0: number, x1: number, y1: number) {
    for (let y = Math.max(0, Math.ceil(y0)); y < Math.min(SIZE, y1); y++) {
      for (let x = Math.max(0, Math.ceil(x0)); x < Math.min(SIZE, x1); x++) {
        this.alpha[y * SIZE + x] = 255;
      }
    }
  }
}

/** Every canvas the component makes, in creation order: guide first, then user. */
let contexts: FakeContext[] = [];
let cleanup: (() => void) | undefined;

beforeEach(() => {
  // Fake timers for the whole file so the sparkle trail's 750ms fade can be
  // driven rather than waited on, and so `getTimerCount` can show that the
  // component cancels its own timers on the way out. `shouldAdvanceTime` keeps
  // waitFor and the rest behaving as they would on the real clock.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  motion.reduced = false;
  contexts = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement & { _ctx?: FakeContext },
  ) {
    if (!this._ctx) {
      this._ctx = new FakeContext();
      contexts.push(this._ctx);
    }
    return this._ctx as unknown as CanvasRenderingContext2D;
  });
  // The canvas is laid out at its intrinsic size, so client and canvas
  // coordinates coincide and the arithmetic below reads as pixels.
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: SIZE,
    bottom: SIZE,
    width: SIZE,
    height: SIZE,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  // jsdom does not implement pointer capture.
  vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  // Belt and braces: the component cancels its own fade timers on unmount, and
  // the case below pins that, but a test that failed mid-stroke should not leak
  // a pending callback into the next file.
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render({ letter = "ب" }: { letter?: string } = {}) {
  const onComplete = vi.fn();
  const view = rtlRender(<LetterTracer letter={letter} onComplete={onComplete} />);
  cleanup = view.unmount;
  return { ...view, onComplete };
}

const canvas = (container: HTMLElement) => container.querySelector("canvas")!;
/** The learner's ink canvas — the guide is offscreen and made first. */
const inkContext = () => contexts[1];

/**
 * Dispatches a pointer event that actually carries coordinates. jsdom's
 * `PointerEvent` drops `clientX`/`clientY`, so the component reads NaN and
 * draws nothing; a `MouseEvent` of the same type keeps them, and React's
 * synthetic handler reads them off the native event either way.
 */
const pointer = (el: Element, type: string, clientX = 0, clientY = 0) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }));

/**
 * One horizontal stroke across the glyph at `y`. The pen is 28px wide, so each
 * stroke covers seven of the thirty sampled rows — three of them clear the 55%
 * threshold and one does not.
 */
const traceRow = (container: HTMLElement, y: number) => {
  const c = canvas(container);
  pointer(c, "pointerdown", GLYPH.x0, y);
  pointer(c, "pointermove", GLYPH.x1, y);
  pointer(c, "pointerup");
};

const traceEnough = (container: HTMLElement) => {
  for (const y of [120, 160, 200]) traceRow(container, y);
};

const bar = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".h-full.transition-all")!;

describe("setting up the trace", () => {
  it("shows the letter to draw over", () => {
    render({ letter: "ج" });

    // The guide is a giant faint glyph under the canvas — the exercise is
    // tracing, not recall.
    expect(screen.getByText("ج")).toBeInTheDocument();
  });

  it("says which way the letter runs", () => {
    const { container } = render();

    // The single most common mistake from an English-writing learner, and the
    // one the coverage score cannot catch — a right-to-left letter traced
    // left-to-right scores exactly the same.
    expect(screen.getByText("Trace right-to-left")).toBeInTheDocument();
    expect(container.querySelector(".lucide-arrow-left")).not.toBeNull();
  });

  it("starts blank and unscored", () => {
    const { container } = render();

    expect(bar(container).style.width).toBe("0%");
    expect(screen.queryByText("Nice tracing!")).toBeNull();
  });
});

describe("tracing", () => {
  it("lays ink down along the stroke", () => {
    const { container } = render();

    traceRow(container, 160);

    expect(inkContext().inked()).toBeGreaterThan(0);
  });

  it("scores the stroke against the letter", () => {
    const { container } = render();

    traceRow(container, 160);

    // One stroke of a pen 28px wide covers roughly a quarter of the glyph, and
    // the bar is scaled against the 55% target rather than against 100%.
    const width = Number.parseInt(bar(container).style.width, 10);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(100);
    expect(screen.queryByText("Nice tracing!")).toBeNull();
  });

  it("says nothing until the stroke is finished", () => {
    const { container } = render();
    const c = canvas(container);

    pointer(c, "pointerdown", GLYPH.x0, 160);
    pointer(c, "pointermove", GLYPH.x1, 160);

    // Scoring mid-stroke would have the bar jump around under the finger, and
    // reading every pixel on every move is the expensive part.
    expect(bar(container).style.width).toBe("0%");
  });

  it("ignores a pointer that moves without pressing", () => {
    const { container } = render();

    pointer(canvas(container), "pointermove", 160, 160);

    // A mouse crossing the canvas is not a stroke.
    expect(inkContext().inked()).toBe(0);
  });

  it("congratulates a trace that covers enough of the letter", () => {
    const { container, onComplete } = render();

    traceEnough(container);

    expect(screen.getByText("Nice tracing!")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("fills the bar and turns it green when done", () => {
    const { container } = render();

    traceEnough(container);

    expect(bar(container).style.width).toBe("100%");
    expect(bar(container).className).toContain("bg-green-500");
  });

  it("never overfills the bar", () => {
    const { container } = render();

    for (const y of [110, 130, 150, 170, 190, 210]) traceRow(container, y);

    // Coverage is scaled against the 55% threshold, so a thorough trace goes
    // well past 1.0 before it is clamped.
    expect(bar(container).style.width).toBe("100%");
  });

  it("only says it once", () => {
    const { container, onComplete } = render();
    traceEnough(container);

    traceRow(container, 140);

    // The caller advances the lesson on this. Firing again as the learner keeps
    // scribbling would skip the next letter.
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("treats a cancelled pointer as a finished stroke", () => {
    const { container, onComplete } = render();
    const c = canvas(container);

    for (const y of [120, 160, 200]) {
      pointer(c, "pointerdown", GLYPH.x0, y);
      pointer(c, "pointermove", GLYPH.x1, y);
      pointer(c, "pointercancel");
    }

    // A finger leaving the screen edge cancels rather than lifts; dropping the
    // score there would lose the trace the learner just made.
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("starting over", () => {
  it("wipes the ink as well as the score", () => {
    const { container } = render();
    traceRow(container, 160);

    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));

    // Clearing only the number would leave the old strokes on the canvas and
    // the next trace would start already half scored.
    expect(inkContext().inked()).toBe(0);
    expect(bar(container).style.width).toBe("0%");
  });

  it("takes the congratulation back", () => {
    const { container } = render();
    traceEnough(container);

    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));

    expect(screen.queryByText("Nice tracing!")).toBeNull();
  });

  it("lets the letter be completed again", () => {
    const { container, onComplete } = render();
    traceEnough(container);
    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));

    traceEnough(container);

    // Practising the same letter twice is the ordinary use; the completion
    // guard has to be cleared with everything else.
    expect(onComplete).toHaveBeenCalledTimes(2);
  });
});

describe("moving to the next letter", () => {
  it("clears the previous letter's trace", () => {
    const { container, rerender } = render({ letter: "ب" });
    traceEnough(container);

    act(() => {
      rerender(<LetterTracer letter="ت" onComplete={vi.fn()} />);
    });

    // The component is reused between letters. A carried-over score would mark
    // the new letter traced before it was touched.
    expect(screen.getByText("ت")).toBeInTheDocument();
    expect(screen.queryByText("Nice tracing!")).toBeNull();
    expect(bar(container).style.width).toBe("0%");
  });

  it("lets the new letter be completed in its own right", () => {
    const { container, rerender } = render({ letter: "ب" });
    traceEnough(container);
    const onComplete = vi.fn();

    act(() => {
      rerender(<LetterTracer letter="ت" onComplete={onComplete} />);
    });
    traceEnough(container);

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("the sparkle trail", () => {
  it("throws sparks along the stroke", () => {
    const { container } = render();

    // The trail is throttled to one spark per 55ms off `performance.now()`,
    // which the fake clock starts at 0 — so the very first move of the run is
    // inside the throttle window unless the clock is nudged past it first.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    traceRow(container, 160);

    // Tracing is slow and repetitive and mostly done by children; the trail is
    // the only thing that makes the stroke feel like it did something.
    expect(container.querySelectorAll(".animate-sparkle").length).toBeGreaterThan(0);
  });

  it("lets them fade", () => {
    const { container } = render();
    traceRow(container, 160);

    act(() => {
      vi.advanceTimersByTime(800);
    });

    // Each spark removes itself; without that the overlay accumulates one node
    // per stroke for the life of the exercise.
    expect(container.querySelectorAll(".animate-sparkle")).toHaveLength(0);
  });

  it("cancels its pending fades when the learner leaves", () => {
    // Each spark schedules a 750ms `setSparkles` and one stroke schedules a
    // dozen. Nothing cancelled them, so tracing a letter and moving straight on
    // left up to a dozen callbacks setting state on a component that no longer
    // existed — and under a runner that tears the DOM down between files, the
    // late callback took the whole run down with "window is not defined".
    const { container, unmount } = render();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    traceRow(container, 160);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => unmount());
    cleanup = undefined;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays still for a learner who asked for less motion", () => {
    motion.reduced = true;
    const { container } = render();

    traceRow(container, 160);

    // The setting is a request, and a trail of animated dots under the finger
    // is exactly what it is asking not to see.
    expect(container.querySelectorAll(".animate-sparkle")).toHaveLength(0);
  });

  it("still scores the trace with motion turned down", () => {
    motion.reduced = true;
    const { container, onComplete } = render();

    traceEnough(container);

    // The trail is decoration; losing it must not cost the exercise.
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
