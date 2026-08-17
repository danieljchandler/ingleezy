import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Horizontal swipe between the app's top-level surfaces.
 *
 * The whole RTL question is settled here, once, so no call site has to think
 * about it. The app runs right-to-left, so "forward" for an Arabic reader is a
 * drag toward the LEFT — the same direction their eye travels. That puts the
 * chooser on the left of the feed and the profile on the right, mirrored from
 * how this would be built in English. Getting it backwards produces an app
 * that feels subtly wrong and never gets reported as a bug, which is exactly
 * why it belongs in one function rather than scattered across pages.
 *
 * Vertical intent wins ties: the feed scrolls up and down, and a swipe that is
 * mostly vertical must never be stolen by the pager.
 */

const MIN_DISTANCE = 60;
/** How much more horizontal than vertical a drag must be to count as a page turn. */
const AXIS_RATIO = 1.6;

export function useSwipeSurfaces({
  onNext,
  onPrev,
}: {
  /** Fired on a forward swipe — leftward, the direction Arabic reads. */
  onNext?: () => void;
  /** Fired on a backward swipe — rightward. */
  onPrev?: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    // Mouse drags are not swipes; only touch and pen turn pages.
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const from = start.current;
    start.current = null;
    if (!from) return;

    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) < MIN_DISTANCE) return;
    if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) return;

    if (dx < 0) onNext?.();
    else onPrev?.();
  };

  return { onPointerDown, onPointerUp, onPointerCancel: () => { start.current = null; } };
}
