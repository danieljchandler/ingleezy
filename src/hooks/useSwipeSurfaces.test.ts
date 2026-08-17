import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSwipeSurfaces } from "./useSwipeSurfaces";

/**
 * The RTL direction decision, pinned.
 *
 * `useSwipeSurfaces` exists so exactly one place in the app decides which
 * physical drag counts as "forward". The app runs right-to-left, so forward is
 * a LEFTWARD drag — the direction an Arabic reader's eye travels — which puts
 * the chooser to the left of the feed. Build it the English way round and you
 * get an app that feels subtly wrong and never gets reported as a bug, because
 * nobody can name what is off. That is precisely the kind of thing worth a
 * test rather than a comment.
 *
 * The gesture start is held in a ref, so these render the hook rather than
 * calling it — a bare call has no React instance to hang that ref on.
 */

type Args = Parameters<typeof useSwipeSurfaces>[0];

/** Renders the hook, then drives one pointer gesture through its handlers. */
function swipe(args: Args, { dx, dy = 0, pointerType = "touch" }: { dx: number; dy?: number; pointerType?: string }) {
  const { result } = renderHook(() => useSwipeSurfaces(args));
  result.current.onPointerDown({ clientX: 200, clientY: 400, pointerType } as never);
  result.current.onPointerUp({ clientX: 200 + dx, clientY: 400 + dy, pointerType } as never);
}

describe("useSwipeSurfaces", () => {
  it("treats a leftward drag as forward, because Arabic reads that way", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    swipe({ onNext, onPrev }, { dx: -120 });

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).not.toHaveBeenCalled();
  });

  it("treats a rightward drag as going back", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    swipe({ onNext, onPrev }, { dx: 120 });

    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("ignores a drag too short to be deliberate", () => {
    const onNext = vi.fn();
    swipe({ onNext }, { dx: -30 });

    expect(onNext).not.toHaveBeenCalled();
  });

  it("lets a mostly-vertical drag through to the feed", () => {
    const onNext = vi.fn();
    // The feed scrolls vertically. A pager that steals a scroll makes the
    // whole surface feel like it is fighting the thumb, which is worse than
    // having no swipe at all.
    swipe({ onNext }, { dx: -70, dy: -200 });

    expect(onNext).not.toHaveBeenCalled();
  });

  it("still turns the page on a diagonal that is mostly horizontal", () => {
    const onNext = vi.fn();
    swipe({ onNext }, { dx: -160, dy: -40 });

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("does not turn pages on a mouse drag", () => {
    const onNext = vi.fn();
    // Desktop drags select text; only touch and pen mean to page.
    swipe({ onNext }, { dx: -200, pointerType: "mouse" });

    expect(onNext).not.toHaveBeenCalled();
  });

  it("forgets a gesture that was cancelled mid-drag", () => {
    const onNext = vi.fn();
    const { result } = renderHook(() => useSwipeSurfaces({ onNext }));
    result.current.onPointerDown({ clientX: 200, clientY: 400, pointerType: "touch" } as never);
    result.current.onPointerCancel();
    result.current.onPointerUp({ clientX: 20, clientY: 400, pointerType: "touch" } as never);

    expect(onNext).not.toHaveBeenCalled();
  });
});
