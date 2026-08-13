import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import { lazyRetry } from "./lazyRetry";

/**
 * Recovery from a chunk that will not load.
 *
 * Every page in the app is code-split, so after a deploy a returning visitor's
 * cached index requests chunk hashes that no longer exist. The import rejects
 * and the whole route white-screens. This wraps it: reload once, and if the
 * reload does not help, let the error through to the ErrorBoundary.
 *
 * The reload-once part is what needs testing. A retry flag that is never
 * cleared reloads forever, which is worse than the blank page it was meant to
 * fix — and because the flag lives in sessionStorage, it survives the very
 * reload that is supposed to clear it.
 */

const CHUNK_ERROR = new Error("Failed to fetch dynamically imported module: /assets/Page-abc123.js");
const RETRY_KEY = "__lazy_route_retry__";

const aModule = { default: (() => null) as unknown as ComponentType };

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => vi.restoreAllMocks());

describe("the happy path", () => {
  it("returns the module", async () => {
    const loaded = await lazyRetry(() => Promise.resolve(aModule))();
    expect(loaded).toBe(aModule);
  });

  it("does not reload", async () => {
    await lazyRetry(() => Promise.resolve(aModule))();
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears a stale retry flag from an earlier failure", async () => {
    // Otherwise the next genuine chunk failure would see a flag it did not set
    // and skip its one legitimate reload.
    sessionStorage.setItem(RETRY_KEY, "1");

    await lazyRetry(() => Promise.resolve(aModule))();

    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });
});

describe("a chunk that will not load", () => {
  it("reloads once and never resolves, so nothing renders mid-reload", async () => {
    const importer = vi.fn().mockRejectedValue(CHUNK_ERROR);

    let settled = false;
    void lazyRetry(importer)().then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    // Resolving here would let React mount a component from a half-loaded page
    // that is about to be thrown away.
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it("records that it has retried, so the reload cannot loop", async () => {
    void lazyRetry(() => Promise.reject(CHUNK_ERROR))();

    await vi.waitFor(() => expect(sessionStorage.getItem(RETRY_KEY)).toBe("1"));
  });

  it("gives up after the reload has already been tried", async () => {
    // The flag survives the reload, which is the point: a second failure means
    // reloading is not the answer.
    sessionStorage.setItem(RETRY_KEY, "1");

    await expect(lazyRetry(() => Promise.reject(CHUNK_ERROR))()).rejects.toThrow(
      /Failed to fetch dynamically imported module/,
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears the flag when it gives up, so a later deploy can retry again", async () => {
    sessionStorage.setItem(RETRY_KEY, "1");

    await expect(lazyRetry(() => Promise.reject(CHUNK_ERROR))()).rejects.toThrow();

    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it("recognises the other wordings browsers use", async () => {
    // Chrome, Firefox and Safari each phrase this differently, and webpack-era
    // bundles use another. Missing one means no reload at all.
    const wordings = [
      "Failed to fetch dynamically imported module: /assets/x.js",
      "Importing a module script failed.",
      "ChunkLoadError: Loading chunk 42 failed.",
      "Loading chunk 7 failed.",
    ];

    for (const message of wordings) {
      sessionStorage.clear();
      reload.mockClear();

      void lazyRetry(() => Promise.reject(new Error(message)))();
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    }
  });
});

describe("an error that is not a chunk failure", () => {
  it("is rethrown without reloading", async () => {
    // A component that throws at module scope would otherwise send the browser
    // into a reload loop that never fixes anything.
    const bug = new TypeError("Cannot read properties of undefined");

    await expect(lazyRetry(() => Promise.reject(bug))()).rejects.toThrow(bug);
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves the retry flag alone", async () => {
    await expect(lazyRetry(() => Promise.reject(new Error("unrelated")))()).rejects.toThrow();
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it("handles a rejection that is not an Error at all", async () => {
    await expect(lazyRetry(() => Promise.reject("just a string"))()).rejects.toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("when sessionStorage is unavailable", () => {
  it("still reloads on a chunk failure", async () => {
    // Safari private mode throws on setItem. Without the fallback the visitor
    // is left on a white screen with no recovery at all.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    void lazyRetry(() => Promise.reject(CHUNK_ERROR))();

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("does not break a successful load", async () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    await expect(lazyRetry(() => Promise.resolve(aModule))()).resolves.toBe(aModule);
  });
});
