import { useEffect, useState } from "react";

/**
 * Height of the on-screen keyboard in CSS pixels, or 0 when it's closed or the
 * browser doesn't expose visualViewport.
 *
 * A bottom sheet sized in `dvh` doesn't shrink when the software keyboard opens
 * — `dvh` tracks the *layout* viewport, which the keyboard doesn't change on
 * iOS — so the composer ends up underneath it. Lifting the sheet by this inset
 * is the only portable fix.
 *
 * The viewport meta is deliberately left alone: `interactive-widget=resizes-content`
 * would do this globally, but it's Chrome-only and would move every fixed
 * bottom element in the app (the nav bar, the phrase bar, both FABs).
 *
 * jsdom has no `visualViewport`, so this is inert in tests.
 */
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!enabled || !vv) {
      setInset(0);
      return;
    }

    const update = () => {
      const next = window.innerHeight - (vv.height + vv.offsetTop);
      // Anything smaller is the URL bar collapsing, not a keyboard.
      setInset(next > 80 ? Math.round(next) : 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return inset;
}
