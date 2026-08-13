import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * Give `waitFor` room to survive a loaded machine.
 *
 * The 1000ms default was set when the suite was mostly pure functions. It now
 * renders hundreds of component trees through react-query and the in-memory
 * backend, and a run under contention took nearly twice as long as an idle one
 * — long enough for a single `waitFor` to time out on work that was about to
 * succeed. A timeout that fires on a slow machine says nothing about the code.
 *
 * Failures still fail; they just get long enough to be believed.
 */
configure({ asyncUtilTimeout: 5000 });

// jsdom leaves the media playback methods unimplemented and throws when they're
// called, so anything rendering <video>/<audio> needs these stubbed.
HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
HTMLMediaElement.prototype.pause = vi.fn();
HTMLMediaElement.prototype.load = vi.fn();

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// ─── Observers ───────────────────────────────────────────────────────────────
// Radix (every dropdown, select, popover, tooltip) and recharts both construct
// these on mount. jsdom ships neither, so without them a large share of the UI
// throws before it renders.

class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): [] {
    return [];
  }
}

vi.stubGlobal("ResizeObserver", MockObserver);
vi.stubGlobal("IntersectionObserver", MockObserver);
vi.stubGlobal("MutationObserver", globalThis.MutationObserver ?? MockObserver);

// ─── Element methods jsdom omits ─────────────────────────────────────────────
// Radix scrolls the active item into view and measures pointer capture on every
// menu interaction; jsdom defines none of these.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

// ─── Object URLs ─────────────────────────────────────────────────────────────
// Audio/image/blob download paths call these; jsdom has no implementation.
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:mock");
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

// ─── Network ─────────────────────────────────────────────────────────────────
/**
 * Nothing in the unit suite may reach the network. The danger is specific, not
 * theoretical: vite.config.ts falls back to the real production Supabase
 * project when its env vars are unset, so a request that escapes the suite can
 * read and write live learner data.
 *
 * A test that legitimately needs fetch stubs it — `vi.stubGlobal("fetch", ...)`
 * — or installs the in-memory Supabase backend. Reaching this function means
 * neither happened, and the message says which to do.
 */
const unstubbedFetch = (input: RequestInfo | URL): never => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  throw new Error(
    `Unstubbed network request to ${url}\n` +
      `The unit suite must not touch the network. Either stub it with ` +
      `vi.stubGlobal("fetch", ...) or install the in-memory Supabase backend.`,
  );
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(unstubbedFetch));
});

afterEach(() => {
  // Radix, sonner and DialectContext all persist to localStorage or mutate
  // documentElement styles; without this, state bleeds between tests.
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.removeAttribute("style");
});
