import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useIsMobile } from "./use-mobile";

/**
 * The one breakpoint the app branches on in JavaScript.
 *
 * Most of the layout is CSS, which needs no help. This exists for the places
 * where the two layouts are genuinely different components rather than the same
 * component restyled — the sidebar becomes a sheet, the review controls become
 * a bottom bar — and rendering the wrong one is not a cosmetic difference.
 *
 * The value is read from `window.innerWidth` while the *subscription* is a
 * media query, so the two have to agree about where 768 sits.
 */

const BREAKPOINT = 768;

/** A matchMedia that actually delivers change events, unlike the global stub. */
function installMatchMedia() {
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth < BREAKPOINT,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: () => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  return listeners;
}

const resizeTo = (width: number, listeners: Set<() => void>) => {
  act(() => {
    window.innerWidth = width;
    listeners.forEach((listener) => listener());
  });
};

const originalWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;

let listeners: Set<() => void>;

beforeEach(() => {
  listeners = installMatchMedia();
});

afterEach(() => {
  window.innerWidth = originalWidth;
  window.matchMedia = originalMatchMedia;
});

describe("deciding which layout to render", () => {
  it("calls a narrow window mobile", () => {
    window.innerWidth = 375;

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it("calls a wide window desktop", () => {
    window.innerWidth = 1280;

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it("puts the boundary just below 768", () => {
    window.innerWidth = BREAKPOINT - 1;
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);

    window.innerWidth = BREAKPOINT;
    // Exactly 768 is a tablet in portrait, which gets the desktop layout — the
    // same line the CSS draws, and the two must not disagree or the JS branch
    // and the stylesheet render different halves of the page.
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("says desktop on the very first render, whatever the device", () => {
    window.innerWidth = 375;

    const seen: boolean[] = [];
    renderHook(() => {
      const isMobile = useIsMobile();
      seen.push(isMobile);
      return isMobile;
    });

    // Pinned. The state starts `undefined` and is only filled in by an effect,
    // and `!!undefined` is false — so a phone renders the desktop branch for
    // one frame before swapping. Where the two branches are different
    // components that is a mount, an unmount and a visible jump on every page
    // load, on the devices most of the app's traffic comes from.
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
  });
});

describe("following a resize", () => {
  it("switches to mobile when the window narrows", () => {
    window.innerWidth = 1280;
    const { result } = renderHook(() => useIsMobile());

    resizeTo(375, listeners);

    // Rotating a tablet, or dragging a desktop window narrow, has to move the
    // layout with it — the alternative is a sidebar with nowhere to sit.
    expect(result.current).toBe(true);
  });

  it("switches back when the window widens", () => {
    window.innerWidth = 375;
    const { result } = renderHook(() => useIsMobile());

    resizeTo(1280, listeners);

    expect(result.current).toBe(false);
  });

  it("stops listening once unmounted", () => {
    window.innerWidth = 375;
    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners.size).toBe(1);

    unmount();

    // Every page mounts this; a leaked listener per navigation would set state
    // on a dozen dead trees on the first rotation.
    expect(listeners.size).toBe(0);
  });
});
