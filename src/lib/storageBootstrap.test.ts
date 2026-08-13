import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The in-memory localStorage shim installed at boot.
 *
 * Safari in private mode, a browser with cookies blocked, and an iframe with a
 * restrictive sandbox all make `localStorage.setItem` throw. Nearly every
 * module in this app writes to storage — the dialect choice, the review queue,
 * display preferences, session resume — so an unguarded throw at import time
 * takes the whole app down before React mounts, with a blank page and a console
 * error nobody sees.
 *
 * The shim replaces the property with a Map-backed stand-in so those writes
 * succeed and are simply forgotten at the end of the session. It runs as a side
 * effect of importing the module, which is why every test here re-imports it.
 */

const ORIGINAL_LOCAL = Object.getOwnPropertyDescriptor(window, "localStorage");
const ORIGINAL_SESSION = Object.getOwnPropertyDescriptor(window, "sessionStorage");

/** Replace a storage with one that throws on every write, as private mode does. */
function breakStorage(key: "localStorage" | "sessionStorage") {
  Object.defineProperty(window, key, {
    configurable: true,
    value: {
      get length() {
        return 0;
      },
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("SecurityError: storage is disabled");
      },
    },
  });
}

function restore() {
  if (ORIGINAL_LOCAL) Object.defineProperty(window, "localStorage", ORIGINAL_LOCAL);
  if (ORIGINAL_SESSION) Object.defineProperty(window, "sessionStorage", ORIGINAL_SESSION);
}

beforeEach(() => {
  restore();
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  restore();
});

describe("when storage works", () => {
  it("leaves the real localStorage in place", async () => {
    localStorage.setItem("kept", "value");

    await import("./storageBootstrap");

    // Replacing a working storage would silently drop everything already
    // persisted for this user.
    expect(localStorage.getItem("kept")).toBe("value");
    localStorage.removeItem("kept");
  });

  it("leaves the real sessionStorage in place", async () => {
    sessionStorage.setItem("kept", "value");

    await import("./storageBootstrap");

    expect(sessionStorage.getItem("kept")).toBe("value");
    sessionStorage.removeItem("kept");
  });
});

describe("when storage is disabled", () => {
  it("makes writes succeed instead of throwing", async () => {
    breakStorage("localStorage");
    expect(() => window.localStorage.setItem("a", "1")).toThrow();

    await import("./storageBootstrap");

    // The whole point: a module that writes at import time no longer takes the
    // app down.
    expect(() => window.localStorage.setItem("a", "1")).not.toThrow();
    expect(window.localStorage.getItem("a")).toBe("1");
  });

  it("shims sessionStorage independently", async () => {
    breakStorage("sessionStorage");

    await import("./storageBootstrap");

    expect(() => window.sessionStorage.setItem("a", "1")).not.toThrow();
    expect(window.sessionStorage.getItem("a")).toBe("1");
  });

  it("says so in the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    breakStorage("localStorage");

    await import("./storageBootstrap");

    // Silent degradation would leave a support conversation with no thread to
    // pull: the session works, and nothing persists between visits.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("localStorage shim"));
  });
});

describe("the in-memory stand-in", () => {
  beforeEach(async () => {
    breakStorage("localStorage");
    await import("./storageBootstrap");
    window.localStorage.clear();
  });

  it("round-trips a value", () => {
    window.localStorage.setItem("dialect", "Egyptian");

    expect(window.localStorage.getItem("dialect")).toBe("Egyptian");
  });

  it("answers null for a key that was never set", () => {
    // `undefined` here would break every `raw === null` default check in the
    // preference modules.
    expect(window.localStorage.getItem("missing")).toBeNull();
  });

  it("coerces keys and values to strings, as the real API does", () => {
    window.localStorage.setItem(1 as unknown as string, 2 as unknown as string);

    expect(window.localStorage.getItem("1")).toBe("2");
  });

  it("overwrites rather than duplicating", () => {
    window.localStorage.setItem("dialect", "Gulf");
    window.localStorage.setItem("dialect", "Yemeni");

    expect(window.localStorage.getItem("dialect")).toBe("Yemeni");
    expect(window.localStorage.length).toBe(1);
  });

  it("removes a key", () => {
    window.localStorage.setItem("dialect", "Gulf");
    window.localStorage.removeItem("dialect");

    expect(window.localStorage.getItem("dialect")).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("ignores removing something that is not there", () => {
    expect(() => window.localStorage.removeItem("missing")).not.toThrow();
  });

  it("counts what it holds", () => {
    window.localStorage.setItem("a", "1");
    window.localStorage.setItem("b", "2");

    expect(window.localStorage.length).toBe(2);
  });

  it("enumerates keys by index in insertion order", () => {
    window.localStorage.setItem("first", "1");
    window.localStorage.setItem("second", "2");

    // The brand migration walks `key(i)` to find everything with a prefix, so
    // indexed access has to work or that migration silently finds nothing.
    expect(window.localStorage.key(0)).toBe("first");
    expect(window.localStorage.key(1)).toBe("second");
  });

  it("answers null past the end rather than undefined", () => {
    window.localStorage.setItem("only", "1");

    expect(window.localStorage.key(5)).toBeNull();
  });

  it("empties on clear", () => {
    window.localStorage.setItem("a", "1");
    window.localStorage.setItem("b", "2");
    window.localStorage.clear();

    expect(window.localStorage.length).toBe(0);
    expect(window.localStorage.getItem("a")).toBeNull();
  });
});
