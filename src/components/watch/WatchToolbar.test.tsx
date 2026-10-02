import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WatchToolbar } from "./WatchToolbar";

/**
 * The Watch screen's bottom bar. Two of its four buttons are modes, and a
 * learner who cannot tell whether "pause after each line" is on will think the
 * player is broken the first time it stops by itself.
 */

function renderBar(over: Partial<Parameters<typeof WatchToolbar>[0]> = {}) {
  const props = {
    speed: 1,
    onSpeed: vi.fn(),
    pauseAfterLine: false,
    onPauseAfterLine: vi.fn(),
    onRepeat: vi.fn(),
    canRepeat: true,
    imitating: false,
    onImitate: vi.fn(),
    canImitate: true,
    ...over,
  };
  render(<WatchToolbar {...props} />);
  return props;
}

describe("WatchToolbar", () => {
  it("names each button in words", () => {
    renderBar();
    const bar = screen.getByRole("navigation", { name: "أدوات المقطع" });
    expect(bar).toBeInTheDocument();
    for (const name of [/كرّر السطر/, /السرعة/, /وقفة بعد السطر/, /قلّدها/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("says the current speed", () => {
    renderBar({ speed: 0.75 });
    expect(screen.getByRole("button", { name: "السرعة 0.75×" })).toBeInTheDocument();
  });

  it("says whether the two modes are on", () => {
    renderBar({ pauseAfterLine: true, imitating: false });
    expect(screen.getByRole("button", { name: /وقفة بعد السطر/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /قلّدها/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not offer imitation or a repeat it cannot do", () => {
    renderBar({ canImitate: false, canRepeat: false });
    expect(screen.getByRole("button", { name: /قلّدها/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /كرّر السطر/ })).toBeDisabled();
  });

  it("calls through on each tap", () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /كرّر السطر/ }));
    fireEvent.click(screen.getByRole("button", { name: /السرعة/ }));
    fireEvent.click(screen.getByRole("button", { name: /وقفة بعد السطر/ }));
    fireEvent.click(screen.getByRole("button", { name: /قلّدها/ }));
    expect(props.onRepeat).toHaveBeenCalledOnce();
    expect(props.onSpeed).toHaveBeenCalledOnce();
    expect(props.onPauseAfterLine).toHaveBeenCalledOnce();
    expect(props.onImitate).toHaveBeenCalledOnce();
  });
});
