import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountdownRing } from "./CountdownRing";

/**
 * The ring that counts a recording window down.
 *
 * Pronunciation practice records for a fixed window, and a learner needs to
 * know how long they have left without reading a number mid-sentence — so the
 * ring empties as the time goes. It is driven by requestAnimationFrame rather
 * than CSS so it can be paused, and it drops to a single fade for anyone who
 * has asked for less motion.
 */

const RADIUS = 44;
const CIRC = 2 * Math.PI * RADIUS;

let frames: FrameRequestCallback[] = [];
let now = 0;

beforeEach(() => {
  frames = [];
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  // Motion is allowed unless a test says otherwise.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Advance the clock and run whatever frame is pending. */
const advance = (ms: number) => {
  now += ms;
  const pending = frames.shift();
  if (pending) act(() => pending(now));
};

const sweep = (container: HTMLElement) =>
  container.querySelectorAll("circle")[1] as SVGCircleElement;

const offset = (container: HTMLElement) =>
  Number(sweep(container).getAttribute("stroke-dashoffset"));

describe("CountdownRing — the sweep", () => {
  it("starts full", () => {
    const { container } = render(<CountdownRing durationMs={1000} />);
    expect(offset(container)).toBe(0);
  });

  it("empties as the window runs down", () => {
    const { container } = render(<CountdownRing durationMs={1000} />);
    advance(500);
    expect(offset(container)).toBeCloseTo(CIRC / 2, 5);
  });

  it("is empty at the end", () => {
    const { container } = render(<CountdownRing durationMs={1000} />);
    advance(1000);
    expect(offset(container)).toBeCloseTo(CIRC, 5);
  });

  it("never sweeps past empty", () => {
    // The last frame can land after the deadline; an offset beyond the
    // circumference would wrap the dash back round to full.
    const { container } = render(<CountdownRing durationMs={1000} />);
    advance(5000);
    expect(offset(container)).toBeCloseTo(CIRC, 5);
  });

  it("stops asking for frames once it is done", () => {
    render(<CountdownRing durationMs={1000} />);
    advance(1000);
    expect(frames).toHaveLength(0);
  });

  it("keeps asking for frames while it runs", () => {
    render(<CountdownRing durationMs={1000} />);
    advance(100);
    expect(frames).toHaveLength(1);
  });

  it("scales to the window it was given", () => {
    const { container } = render(<CountdownRing durationMs={4000} />);
    advance(1000);
    expect(offset(container)).toBeCloseTo(CIRC / 4, 5);
  });
});

describe("CountdownRing — pausing", () => {
  it("does not start while paused", () => {
    render(<CountdownRing durationMs={1000} paused />);
    expect(frames).toHaveLength(0);
  });

  it("stays full while paused", () => {
    const { container } = render(<CountdownRing durationMs={1000} paused />);
    expect(offset(container)).toBe(0);
  });

  it("starts once unpaused", () => {
    const { rerender } = render(<CountdownRing durationMs={1000} paused />);
    rerender(<CountdownRing durationMs={1000} />);
    expect(frames.length).toBeGreaterThan(0);
  });
});

describe("CountdownRing — reduced motion", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
  });

  it("does not animate at all", () => {
    render(<CountdownRing durationMs={1000} />);
    expect(frames).toHaveLength(0);
  });

  it("leaves the ring whole rather than sweeping it", () => {
    const { container } = render(<CountdownRing durationMs={1000} />);
    expect(offset(container)).toBe(0);
  });

  it("fades instead", () => {
    // A single opacity step conveys "time is passing" without the rotation
    // that triggers vestibular discomfort.
    const { container } = render(<CountdownRing durationMs={1000} />);
    expect(Number(sweep(container).style.opacity)).toBeCloseTo(0.3, 5);
  });
});

describe("CountdownRing — what it wraps", () => {
  it("centres whatever it is given", () => {
    render(
      <CountdownRing durationMs={1000}>
        <span>3</span>
      </CountdownRing>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders without any children", () => {
    const { container } = render(<CountdownRing durationMs={1000} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("takes the caller's accent colour", () => {
    // Recording is primary; the last seconds turn destructive.
    const { container } = render(
      <CountdownRing durationMs={1000} colorClass="text-destructive" />,
    );
    expect(sweep(container).getAttribute("class")).toContain("text-destructive");
  });

  it("defaults to the primary accent", () => {
    const { container } = render(<CountdownRing durationMs={1000} />);
    expect(sweep(container).getAttribute("class")).toContain("text-primary");
  });
});
