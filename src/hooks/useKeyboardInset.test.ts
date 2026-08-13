import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useKeyboardInset } from "./useKeyboardInset";

/**
 * How much of the screen the software keyboard is covering.
 *
 * The Ask AI sheet is sized in `dvh`, which tracks the layout viewport — and
 * the keyboard doesn't change that on iOS. So the sheet keeps its full height
 * and the composer ends up underneath the keyboard. `visualViewport` is the
 * only thing that reports the difference, and the interesting part is telling a
 * real keyboard apart from the mobile URL bar collapsing, which fires the same
 * events for a much smaller delta.
 *
 * jsdom has no `visualViewport` at all, which is itself a case worth pinning:
 * the hook has to stay inert rather than throw.
 */

const ORIGINAL_INNER_HEIGHT = window.innerHeight;

/** A visualViewport whose height we can move, with working listeners. */
function installVisualViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Set<() => void>>();
  const vv = {
    height,
    offsetTop,
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
  Object.defineProperty(window, "visualViewport", {
    value: vv,
    configurable: true,
    writable: true,
  });
  return {
    /** Shrink the visual viewport as an on-screen keyboard would. */
    resizeTo(next: number) {
      act(() => {
        vv.height = next;
        listeners.get("resize")?.forEach((l) => l());
      });
    },
  };
}

function removeVisualViewport() {
  Object.defineProperty(window, "visualViewport", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  removeVisualViewport();
  window.innerHeight = ORIGINAL_INNER_HEIGHT;
});

describe("useKeyboardInset", () => {
  it("reports nothing when the browser has no visualViewport", () => {
    removeVisualViewport();
    const { result } = renderHook(() => useKeyboardInset(true));
    expect(result.current).toBe(0);
  });

  it("reports nothing while the keyboard is closed", () => {
    window.innerHeight = 800;
    installVisualViewport(800);
    const { result } = renderHook(() => useKeyboardInset(true));
    expect(result.current).toBe(0);
  });

  it("reports the covered height once the keyboard opens", () => {
    window.innerHeight = 800;
    const vv = installVisualViewport(800);
    const { result } = renderHook(() => useKeyboardInset(true));

    vv.resizeTo(460);
    expect(result.current).toBe(340);

    vv.resizeTo(800);
    expect(result.current).toBe(0);
  });

  it("ignores the URL bar collapsing, which is the same event at a smaller delta", () => {
    window.innerHeight = 800;
    const vv = installVisualViewport(800);
    const { result } = renderHook(() => useKeyboardInset(true));

    vv.resizeTo(740); // 60px of browser chrome, not a keyboard
    expect(result.current).toBe(0);
  });

  it("stays inert while disabled, so a closed panel doesn't track the viewport", () => {
    window.innerHeight = 800;
    const vv = installVisualViewport(800);
    const { result } = renderHook(() => useKeyboardInset(false));

    vv.resizeTo(460);
    expect(result.current).toBe(0);
  });

  it("accounts for a visual viewport that is offset rather than shortened", () => {
    window.innerHeight = 800;
    installVisualViewport(600, 200); // scrolled within the layout viewport
    const { result } = renderHook(() => useKeyboardInset(true));
    expect(result.current).toBe(0);
  });
});
