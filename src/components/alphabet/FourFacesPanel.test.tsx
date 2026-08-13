import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArabicLetter } from "@/data/arabicAlphabet";
import { FourFacesPanel } from "./FourFacesPanel";

/**
 * A letter in all four of its positional forms.
 *
 * This is the fact about Arabic that surprises every beginner: ع at the start
 * of a word does not look like ع at the end, and a learner who has only met the
 * isolated glyph cannot read a word containing it. Showing the four side by
 * side is the whole point, and the rotating spotlight exists to make them read
 * as one letter changing rather than four separate symbols.
 */

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/lib/uiPrefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uiPrefs")>()),
  prefersReducedMotion: () => motion.reduced,
}));

const AYN = {
  code: "ayn",
  isolated: "ع",
  initial: "عـ",
  medial: "ـعـ",
  final: "ـع",
  name_ar: "عين",
} as ArabicLetter;

const HA = {
  code: "ha",
  isolated: "ح",
  initial: "حـ",
  medial: "ـحـ",
  final: "ـح",
  name_ar: "حاء",
} as ArabicLetter;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  motion.reduced = false;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

const cards = (container: HTMLElement) => [...container.querySelectorAll(".rounded-2xl")];
const activeIndex = (container: HTMLElement) =>
  cards(container).findIndex((c) => c.className.includes("border-primary"));

describe("FourFacesPanel — the four forms", () => {
  it("shows all four", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    expect(cards(container)).toHaveLength(4);
  });

  it("shows each glyph", () => {
    render(<FourFacesPanel letter={AYN} />);
    expect(screen.getByText("ع")).toBeInTheDocument();
    expect(screen.getByText("عـ")).toBeInTheDocument();
    expect(screen.getByText("ـعـ")).toBeInTheDocument();
    expect(screen.getByText("ـع")).toBeInTheDocument();
  });

  it("names each position", () => {
    render(<FourFacesPanel letter={AYN} />);
    for (const label of ["Isolated", "Initial", "Medial", "Final"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("says where in a word each one belongs", () => {
    // "Medial" is jargon; "at the middle" is the thing a learner can act on.
    render(<FourFacesPanel letter={AYN} />);
    expect(screen.getByText("at the alone")).toBeInTheDocument();
    expect(screen.getByText("at the start")).toBeInTheDocument();
    expect(screen.getByText("at the middle")).toBeInTheDocument();
    expect(screen.getByText("at the end")).toBeInTheDocument();
  });

  it("keeps them in reading order", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    expect(cards(container).map((c) => c.querySelector("p")!.textContent)).toEqual([
      "Isolated",
      "Initial",
      "Medial",
      "Final",
    ]);
  });
});

describe("FourFacesPanel — the spotlight", () => {
  it("starts on the isolated form", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    expect(activeIndex(container)).toBe(0);
  });

  it("moves along", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    tick(1600);
    expect(activeIndex(container)).toBe(1);
    tick(1600);
    expect(activeIndex(container)).toBe(2);
  });

  it("wraps round rather than stopping", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    tick(1600 * 4);
    expect(activeIndex(container)).toBe(0);
  });

  it("highlights exactly one at a time", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    tick(1600);
    expect(cards(container).filter((c) => c.className.includes("border-primary"))).toHaveLength(1);
  });

  it("replays the morph on the highlighted glyph", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    expect(container.querySelector(".animate-face-morph")).toBeInTheDocument();
  });

  it("starts over when the learner moves to another letter", () => {
    // Otherwise the new letter opens part-way through the cycle, on a form the
    // learner has not been introduced to yet.
    const { container, rerender } = render(<FourFacesPanel letter={AYN} />);
    tick(1600 * 2);
    expect(activeIndex(container)).toBe(2);

    rerender(<FourFacesPanel letter={HA} />);
    expect(activeIndex(container)).toBe(0);
  });

  it("shows the new letter's forms", () => {
    const { rerender } = render(<FourFacesPanel letter={AYN} />);
    rerender(<FourFacesPanel letter={HA} />);
    expect(screen.getByText("ح")).toBeInTheDocument();
    expect(screen.queryByText("ع")).not.toBeInTheDocument();
  });

  it("stops cycling once the panel is gone", () => {
    const { unmount } = render(<FourFacesPanel letter={AYN} />);
    unmount();
    // No interval left to fire into a torn-down tree.
    expect(() => tick(1600 * 3)).not.toThrow();
  });
});

describe("FourFacesPanel — reduced motion", () => {
  beforeEach(() => {
    motion.reduced = true;
  });

  it("highlights nothing", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    expect(activeIndex(container)).toBe(-1);
  });

  it("does not cycle", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    tick(1600 * 3);
    expect(activeIndex(container)).toBe(-1);
  });

  it("still shows all four forms", () => {
    // The content is the point; the animation is decoration.
    render(<FourFacesPanel letter={AYN} />);
    expect(screen.getByText("ع")).toBeInTheDocument();
    expect(screen.getByText("ـع")).toBeInTheDocument();
  });

  it("runs no morph animation", () => {
    const { container } = render(<FourFacesPanel letter={AYN} />);
    expect(container.querySelector(".animate-face-morph")).toBeNull();
  });
});
