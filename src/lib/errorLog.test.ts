import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSupabaseFetch } from "@/test/support/transports/vitest";
import { TEST_USER_ID } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The client-side error sink.
 *
 * Everything about this module is a defence against itself. It is called from
 * the global `error` and `unhandledrejection` handlers, so anything it throws
 * happens *while the app is already broken* and would replace a useful error
 * with a confusing one. It is also called from inside failure paths that can
 * loop, so it is rate limited — a render loop throwing on every frame must not
 * write a row per frame.
 *
 * The rate-limit bucket is module state, so each test imports the module fresh
 * rather than sharing a window with the one before it. That re-imports the
 * supabase client singleton too, which makes GoTrue log its "multiple
 * instances" notice once per test — harmless here, and the price of the bucket
 * actually being empty at the start of each case. (`emulator.test.ts` avoids it
 * by giving each of its own clients a distinct storage key; this file cannot,
 * because the client under test is the app's.)
 */

let backend: SupabaseBackend;
let restore: () => void;

/** Import a fresh copy, so the rate-limit bucket starts empty. */
async function freshLogger() {
  vi.resetModules();
  return (await import("./errorLog")).logClientError;
}

function install(signedInAs: string | null = TEST_USER_ID) {
  const installed = installSupabaseFetch({ signedInAs });
  backend = installed.backend;
  restore = installed.restore;
  backend.db.seed("client_errors", []);
}

afterEach(() => {
  restore?.();
  vi.useRealTimers();
});

describe("what gets written", () => {
  beforeEach(() => install());

  it("records the message and marks it as a client error", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "Cannot read properties of null" });

    expect(backend.db.rows("client_errors")).toHaveLength(1);
    expect(backend.db.rows("client_errors")[0]).toMatchObject({
      user_id: TEST_USER_ID,
      source: "client",
      message: "Cannot read properties of null",
    });
  });

  it("records an edge failure under its own source", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "upstream 502", source: "edge" });

    // The admin error log's whole filter hangs off this column.
    expect(backend.db.rows("client_errors")[0].source).toBe("edge");
  });

  it("falls back to the current route", async () => {
    const logClientError = await freshLogger();
    window.history.pushState({}, "", "/review?deck=my-words");

    await logClientError({ message: "boom" });

    // The route is what turns a stack trace into something reproducible, and
    // the caller almost never passes it.
    expect(backend.db.rows("client_errors")[0].route).toBe("/review?deck=my-words");
  });

  it("prefers a route the caller supplied", async () => {
    const logClientError = await freshLogger();
    window.history.pushState({}, "", "/settings");

    await logClientError({ message: "boom", route: "/learn/abc" });

    // An error reported asynchronously can outlive the page it came from.
    expect(backend.db.rows("client_errors")[0].route).toBe("/learn/abc");
  });

  it("records the user agent", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "boom" });

    expect(String(backend.db.rows("client_errors")[0].user_agent)).toContain("Mozilla");
  });

  it("stores an empty object rather than nothing for meta", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "boom" });

    // The column is NOT NULL; `undefined` would be a not-null violation and
    // the log would be lost at exactly the moment it was wanted.
    expect(backend.db.rows("client_errors")[0].meta).toEqual({});
  });

  it("keeps the meta a caller supplied", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "boom", meta: { lessonId: "l1", attempt: 2 } });

    expect(backend.db.rows("client_errors")[0].meta).toEqual({ lessonId: "l1", attempt: 2 });
  });
});

describe("truncation", () => {
  beforeEach(() => install());

  it("cuts an oversized message down", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "x".repeat(5000) });

    // A minified bundle can produce enormous messages, and a rejected insert
    // loses the error entirely.
    expect(String(backend.db.rows("client_errors")[0].message)).toHaveLength(2000);
  });

  it("cuts an oversized stack down", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "boom", stack: "y".repeat(20_000) });

    expect(String(backend.db.rows("client_errors")[0].stack)).toHaveLength(8000);
  });

  it("leaves a short message alone", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "short" });

    expect(backend.db.rows("client_errors")[0].message).toBe("short");
  });

  it("substitutes a placeholder for an empty message", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "" });

    // The column is NOT NULL, and an empty string truncates to null through
    // `truncate`'s falsy check — so the placeholder is what keeps the row
    // insertable.
    expect(backend.db.rows("client_errors")[0].message).toBe("(empty)");
  });

  it("stores a missing stack as null rather than undefined", async () => {
    const logClientError = await freshLogger();

    await logClientError({ message: "boom" });

    expect(backend.db.rows("client_errors")[0].stack).toBeNull();
  });
});

describe("rate limiting", () => {
  beforeEach(() => install());

  it("lets ten errors through a window", async () => {
    const logClientError = await freshLogger();

    for (let i = 0; i < 10; i++) await logClientError({ message: `boom ${i}` });

    expect(backend.db.rows("client_errors")).toHaveLength(10);
  });

  it("drops the eleventh", async () => {
    const logClientError = await freshLogger();

    for (let i = 0; i < 15; i++) await logClientError({ message: `boom ${i}` });

    // The case this exists for: a render loop throwing on every frame would
    // otherwise write thousands of identical rows and bury everything else in
    // the admin log.
    expect(backend.db.rows("client_errors")).toHaveLength(10);
  });

  it("lets errors through again once the window has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const logClientError = await freshLogger();

    for (let i = 0; i < 12; i++) await logClientError({ message: `first ${i}` });
    expect(backend.db.rows("client_errors")).toHaveLength(10);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    await logClientError({ message: "later" });

    // A sliding window, not a session cap — an app that broke once an hour
    // should still be reporting it an hour later.
    expect(backend.db.rows("client_errors")).toHaveLength(11);
  });
});

describe("when it cannot log", () => {
  it("drops the error for a signed-out visitor", async () => {
    install(null);
    const logClientError = await freshLogger();

    await logClientError({ message: "boom" });

    // RLS forbids the insert for anon, so the check is not a policy of its own
    // — it just avoids a guaranteed 403 on every anonymous crash.
    expect(backend.db.rows("client_errors")).toHaveLength(0);
  });

  it("does not throw when the insert is refused", async () => {
    install();
    backend.db.failWrites("client_errors", 500);
    const logClientError = await freshLogger();

    // The contract that matters most. This runs inside `window.onerror`; an
    // exception here replaces the app's real error with the logger's.
    await expect(logClientError({ message: "boom" })).resolves.toBeUndefined();
  });

  it("does not throw when the network is gone", async () => {
    install();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const logClientError = await freshLogger();

    await expect(logClientError({ message: "boom" })).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
