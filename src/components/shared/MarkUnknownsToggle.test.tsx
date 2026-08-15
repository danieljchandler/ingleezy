import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkUnknownsToggle } from "./MarkUnknownsToggle";

/**
 * The switch into "mark unknowns" mode.
 *
 * Normally tapping an Arabic word opens a translation popover, one word at a
 * time. That is the wrong shape for a reader working through a passage: they
 * want to sweep up everything they did not know and deal with it at the end. So
 * this flips the tap behaviour to batching, and SaveUnknownsBar handles the
 * batch.
 */

const context = vi.hoisted(() => ({
  enabled: false,
  setEnabled: vi.fn(),
  unknowns: new Map<string, unknown>(),
  isMarked: vi.fn(),
  toggle: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/contexts/MarkUnknownsContext", () => ({
  useMarkUnknowns: () => context,
}));

beforeEach(() => {
  context.enabled = false;
  context.unknowns = new Map();
  context.setEnabled.mockReset();
  context.clear.mockReset();
});

const button = () => screen.getByRole("button");
const withMarked = (...words: string[]) => {
  context.unknowns = new Map(words.map((w) => [w, { arabic: w }]));
};

describe("MarkUnknownsToggle — turning marking on", () => {
  it("invites the reader in", () => {
    render(<MarkUnknownsToggle />);
    expect(button()).toHaveTextContent("علّم اللي ما تعرفه");
  });

  it("turns marking on when tapped", () => {
    render(<MarkUnknownsToggle />);
    fireEvent.click(button());
    expect(context.setEnabled).toHaveBeenCalledWith(true);
  });

  it("clears nothing on the way in", () => {
    render(<MarkUnknownsToggle />);
    fireEvent.click(button());
    expect(context.clear).not.toHaveBeenCalled();
  });

  it("looks like a secondary action while off", () => {
    const { container } = render(<MarkUnknownsToggle />);
    expect(container.querySelector(".border-input")).toBeInTheDocument();
  });
});

describe("MarkUnknownsToggle — while marking", () => {
  beforeEach(() => {
    context.enabled = true;
  });

  it("says the mode is active", () => {
    render(<MarkUnknownsToggle />);
    expect(button()).toHaveTextContent("نعلّم");
  });

  it("stands out while active", () => {
    // The tap behaviour of the whole passage has changed; that needs to be
    // visible or the next tap is a surprise.
    const { container } = render(<MarkUnknownsToggle />);
    expect(container.querySelector(".bg-primary")).toBeInTheDocument();
  });

  it("turns marking off when nothing has been marked yet", () => {
    render(<MarkUnknownsToggle />);
    fireEvent.click(button());
    expect(context.setEnabled).toHaveBeenCalledWith(false);
    expect(context.clear).not.toHaveBeenCalled();
  });

  it("keeps a batch of marked words on the way out", () => {
    // This used to call clear() too, so a reader who had worked down a passage
    // marking twelve words and tapped the button — reasonably, to stop marking
    // — lost all twelve, with no confirmation and no undo. SaveUnknownsBar
    // shows on the count alone, so the batch keeps its Save and Discard.
    withMarked("سوق", "خبز", "حليب");
    render(<MarkUnknownsToggle />);

    fireEvent.click(button());

    expect(context.setEnabled).toHaveBeenCalledWith(false);
    expect(context.clear).not.toHaveBeenCalled();
  });

  it("keeps even a single marked word", () => {
    withMarked("سوق");
    render(<MarkUnknownsToggle />);
    fireEvent.click(button());
    expect(context.clear).not.toHaveBeenCalled();
  });

  it("never discards the batch itself, whatever the state", () => {
    // Discarding is SaveUnknownsBar's to offer; this button only switches the
    // mode. Pinned so a future tidy-up cannot quietly reintroduce the loss.
    withMarked("سوق", "خبز");
    render(<MarkUnknownsToggle />);
    fireEvent.click(button());
    fireEvent.click(button());
    expect(context.clear).not.toHaveBeenCalled();
  });
});
