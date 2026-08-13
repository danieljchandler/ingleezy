import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Service worker registration.
 *
 * A service worker sits in front of every request the page makes, so getting
 * this wrong is not a missing feature — it is a stale shell served to a
 * developer, or a cache layer in front of the hermetic test suite making it
 * non-deterministic. The module's answer is to register only in production
 * builds and to actively *unregister* anywhere else, so both halves are worth
 * pinning: that a dev build cleans up, and that a failure to register costs
 * nothing but offline support.
 */

function fakeRegistration() {
  return { unregister: vi.fn().mockResolvedValue(true) };
}

function installServiceWorkerApi(registrations: Array<{ unregister: () => Promise<boolean> }>) {
  const api = {
    register: vi.fn().mockResolvedValue({}),
    getRegistrations: vi.fn().mockResolvedValue(registrations),
  };
  vi.stubGlobal("navigator", { ...navigator, serviceWorker: api });
  return api;
}

/** Import fresh, so `import.meta.env.PROD` is read at the value just stubbed. */
async function loadModule() {
  vi.resetModules();
  return import("./serviceWorker");
}

/**
 * `registerServiceWorker` defers its work to a `load` listener and nothing ever
 * takes that listener off again. Left in place it fires on the *next* test's
 * `load` dispatch and calls whatever `navigator.serviceWorker` is stubbed in by
 * then — which is how "registers nothing" saw three registrations once the
 * tests ran in a different order. Every listener added during a test is
 * recorded here and removed after it.
 */
const realAddEventListener = window.addEventListener.bind(window);
let added: Array<[string, EventListenerOrEventListenerObject]> = [];

beforeEach(() => {
  added = [];
  window.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    added.push([type, listener]);
    realAddEventListener(type, listener, options);
  }) as typeof window.addEventListener;
});

afterEach(() => {
  for (const [type, listener] of added) window.removeEventListener(type, listener);
  window.addEventListener = realAddEventListener as typeof window.addEventListener;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("in a development build", () => {
  beforeEach(() => {
    vi.stubEnv("PROD", false);
  });

  it("registers nothing", async () => {
    const api = installServiceWorkerApi([]);
    const { registerServiceWorker } = await loadModule();

    registerServiceWorker();
    window.dispatchEvent(new Event("load"));

    // The Playwright suite answers every Supabase request from fixtures at a
    // fake host; a worker caching in front of that would make it flaky for no
    // benefit at all.
    expect(api.register).not.toHaveBeenCalled();
  });

  it("clears out a worker left behind by an earlier production build", async () => {
    const stale = fakeRegistration();
    installServiceWorkerApi([stale]);
    const { registerServiceWorker } = await loadModule();

    registerServiceWorker();
    await vi.waitFor(() => expect(stale.unregister).toHaveBeenCalled());

    // The situation this exists for: a developer loaded a production build on
    // localhost once, and is now permanently served its stale shell.
  });

  it("clears out several at once", async () => {
    const first = fakeRegistration();
    const second = fakeRegistration();
    installServiceWorkerApi([first, second]);
    const { registerServiceWorker } = await loadModule();

    registerServiceWorker();

    await vi.waitFor(() => {
      expect(first.unregister).toHaveBeenCalled();
      expect(second.unregister).toHaveBeenCalled();
    });
  });
});

describe("in a production build", () => {
  beforeEach(() => {
    vi.stubEnv("PROD", true);
  });

  it("waits for load before registering", async () => {
    const api = installServiceWorkerApi([]);
    const { registerServiceWorker } = await loadModule();

    registerServiceWorker();

    // Registering during startup competes with first paint for exactly no
    // benefit — nothing needs the worker on the first render.
    expect(api.register).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("load"));
    expect(api.register).toHaveBeenCalledWith("/sw.js");
  });

  it("does not unregister anything", async () => {
    const existing = fakeRegistration();
    installServiceWorkerApi([existing]);
    const { registerServiceWorker } = await loadModule();

    registerServiceWorker();
    window.dispatchEvent(new Event("load"));

    expect(existing.unregister).not.toHaveBeenCalled();
  });

  it("carries on when registration is refused", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const api = installServiceWorkerApi([]);
    api.register.mockRejectedValue(new Error("insecure origin"));
    const { registerServiceWorker } = await loadModule();

    registerServiceWorker();
    window.dispatchEvent(new Event("load"));

    // A rejected registration must not surface as an unhandled rejection —
    // the global handler would log it as a crash and the crash toast would
    // greet the learner on next boot.
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});

describe("where service workers do not exist", () => {
  it("does nothing rather than throwing on register", async () => {
    vi.stubEnv("PROD", true);
    const bare = { ...navigator };
    delete (bare as { serviceWorker?: unknown }).serviceWorker;
    vi.stubGlobal("navigator", bare);
    const { registerServiceWorker } = await loadModule();

    // Private browsing in some browsers, and older Safari, have no
    // `serviceWorker` at all.
    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("does nothing rather than throwing on unregister", async () => {
    const bare = { ...navigator };
    delete (bare as { serviceWorker?: unknown }).serviceWorker;
    vi.stubGlobal("navigator", bare);
    const { unregisterServiceWorker } = await loadModule();

    await expect(unregisterServiceWorker()).resolves.toBeUndefined();
  });

  it("swallows a failure to enumerate registrations", async () => {
    const api = installServiceWorkerApi([]);
    api.getRegistrations.mockRejectedValue(new Error("SecurityError"));
    const { unregisterServiceWorker } = await loadModule();

    // Nothing to clean up is indistinguishable from not being allowed to look,
    // and neither is worth an error on a page that is otherwise fine.
    await expect(unregisterServiceWorker()).resolves.toBeUndefined();
  });
});
