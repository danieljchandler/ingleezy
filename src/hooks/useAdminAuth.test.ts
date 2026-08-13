import { afterEach, describe, expect, it } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aRole, TEST_USER_ID } from "@/test/support/factories";
import { useAdminAuth } from "./useAdminAuth";

/**
 * The gate on all 38 admin routes.
 *
 * Every one of them is decided here, by three parallel `has_role` calls. This
 * was untestable until the in-memory backend implemented RPCs — the previous
 * double answered `null`, so the hook always reported no roles and the whole
 * admin console was beyond reach of a test.
 *
 * Two details are worth pinning beyond the obvious: `role` is a precedence
 * order, not a set, and a token refresh must not re-enter loading. The second
 * has a comment in the source about the white flash it causes, which means it
 * has been noticed and fixed at least once.
 */

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

/** Wait for the initial role resolution to finish. */
async function settled(result: { current: { loading: boolean } }) {
  await waitFor(() => expect(result.current.loading).toBe(false));
}

describe("resolving roles", () => {
  it("reports an admin", async () => {
    const rendered = renderHookWithProviders(() => useAdminAuth(), { persona: "admin" });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.isAdmin).toBe(true);
    expect(rendered.result.current.role).toBe("admin");
  });

  it("reports a content reviewer", async () => {
    const rendered = renderHookWithProviders(() => useAdminAuth(), { persona: "content_reviewer" });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.isContentReviewer).toBe(true);
    expect(rendered.result.current.isAdmin).toBe(false);
    expect(rendered.result.current.role).toBe("content_reviewer");
  });

  it("reports a recorder", async () => {
    const rendered = renderHookWithProviders(() => useAdminAuth(), { persona: "recorder" });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.isRecorder).toBe(true);
    expect(rendered.result.current.role).toBe("recorder");
  });

  it("gives a plain learner no role at all", async () => {
    const rendered = renderHookWithProviders(() => useAdminAuth(), { persona: "free" });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.isAdmin).toBe(false);
    expect(rendered.result.current.isContentReviewer).toBe(false);
    expect(rendered.result.current.isRecorder).toBe(false);
    expect(rendered.result.current.role).toBeNull();
  });

  it("stops loading for a signed-out visitor without asking about roles", async () => {
    const rendered = renderHookWithProviders(() => useAdminAuth(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.user).toBeNull();
    expect(rendered.result.current.isAdmin).toBe(false);
  });
});

describe("role precedence", () => {
  it("prefers admin when someone holds several roles", async () => {
    // `role` drives what the console shows; a user who is both admin and
    // reviewer should see the admin view, not the narrower one.
    const rendered = renderHookWithProviders(() => useAdminAuth(), {
      persona: "admin",
      seed: (backend) =>
        backend.db.seed("user_roles", [
          aRole("content_reviewer", { id: "r1" }),
          aRole("recorder", { id: "r2" }),
          aRole("admin", { id: "r3" }),
        ]),
    });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.role).toBe("admin");
    // The individual flags stay true — AdminLayout reads them separately.
    expect(rendered.result.current.isContentReviewer).toBe(true);
    expect(rendered.result.current.isRecorder).toBe(true);
  });

  it("prefers content_reviewer over recorder", async () => {
    const rendered = renderHookWithProviders(() => useAdminAuth(), {
      persona: "content_reviewer",
      seed: (backend) =>
        backend.db.seed("user_roles", [
          aRole("recorder", { id: "r1" }),
          aRole("content_reviewer", { id: "r2" }),
        ]),
    });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.role).toBe("content_reviewer");
  });
});

describe("when the role check fails", () => {
  it("denies access rather than assuming the best", async () => {
    // Failing open here would hand the admin console to anyone whose role
    // lookup happened to error.
    const rendered = renderHookWithProviders(() => useAdminAuth(), {
      persona: "admin",
      seed: (backend) =>
        backend.stubRpc("has_role", () => {
          throw new Error("role lookup unavailable");
        }),
    });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.isAdmin).toBe(false);
    expect(rendered.result.current.role).toBeNull();
  });

  it("stops loading, so the page does not hang on a spinner", async () => {
    const rendered = renderHookWithProviders(() => useAdminAuth(), {
      persona: "admin",
      seed: (backend) =>
        backend.stubRpc("has_role", () => {
          throw new Error("role lookup unavailable");
        }),
    });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.loading).toBe(false);
  });
});

describe("signing out", () => {
  it("drops every role immediately", async () => {
    const rendered = renderHookWithProviders(() => useAdminAuth(), { persona: "admin" });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    expect(rendered.result.current.isAdmin).toBe(true);

    await act(async () => {
      await rendered.result.current.signOut();
    });

    await waitFor(() => expect(rendered.result.current.isAdmin).toBe(false));
    expect(rendered.result.current.role).toBeNull();
    expect(rendered.result.current.user).toBeNull();
  });
});

describe("role lookups", () => {
  it("asks about exactly the three admin roles, for the signed-in user", async () => {
    const rendered = renderHookWithProviders(() => useAdminAuth(), { persona: "admin" });
    cleanup = rendered.cleanup;

    await settled(rendered.result);

    const asked = rendered.backend.rpcCallsTo("has_role");
    expect([...new Set(asked.map((call) => call.args._role))].sort()).toEqual([
      "admin",
      "content_reviewer",
      "recorder",
    ]);

    // Each names the user explicitly rather than relying on the session, since
    // has_role takes the id as an argument.
    for (const call of asked) {
      expect(call.args._user_id).toBe(TEST_USER_ID);
    }
  });

  it("checks each role twice on first load, not once", async () => {
    // Recording current behaviour, which costs six round-trips where three
    // would do. `init()` calls checkRoles for the existing session, and the
    // onAuthStateChange listener it then subscribes fires INITIAL_SESSION
    // immediately and calls it again — the id is unchanged, so the second pass
    // does not re-enter loading, but it does repeat all three lookups.
    //
    // Harmless but not free: this runs before the first paint of every admin
    // page. Guarding checkRoles on the id it last resolved would halve it. If
    // that is done, this test should change to expect three.
    const rendered = renderHookWithProviders(() => useAdminAuth(), { persona: "admin" });
    cleanup = rendered.cleanup;

    await settled(rendered.result);

    expect(rendered.backend.rpcCallsTo("has_role")).toHaveLength(6);
  });

  it("does not ask again for the same user on a re-render", async () => {
    // This runs before every admin page render; three round-trips per render
    // would be felt.
    const rendered = renderHookWithProviders(() => useAdminAuth(), { persona: "admin" });
    cleanup = rendered.cleanup;

    await settled(rendered.result);
    const initial = rendered.backend.rpcCallsTo("has_role").length;

    rendered.rerender();
    await settled(rendered.result);

    expect(rendered.backend.rpcCallsTo("has_role")).toHaveLength(initial);
  });
});
