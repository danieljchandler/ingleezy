import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aRole } from "@/test/support/factories";
import { useBibleAccess } from "./useBibleAccess";
import type { Persona } from "@/test/support/personas";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Who may read the Bible material.
 *
 * The rule is admin OR (bible_reader AND NOT content_reviewer) — the exclusion
 * is deliberate, not an oversight: content reviewers are contractors brought in
 * to check dialect quality, and this material is not theirs to read. It is
 * enforced in SQL rather than in the client, so this hook's job is to ask the
 * right question and to fail closed when it cannot.
 *
 * The pages it guards have no route-level protection at all — the whole gate is
 * this boolean — so "denied" has to be the answer for every case that is not
 * explicitly allowed.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

async function accessFor(persona: Persona | undefined, seed?: (b: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(() => useBibleAccess(), { persona, seed });
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.loading).toBe(false));
  return harness;
}

describe("who gets in", () => {
  it("lets an admin in", async () => {
    const { result } = await accessFor("admin");
    expect(result.current.hasAccess).toBe(true);
  });

  it("lets a bible reader in", async () => {
    const { result } = await accessFor("bible_reader");
    expect(result.current.hasAccess).toBe(true);
  });

  it("keeps a plain learner out", async () => {
    const { result } = await accessFor("free");
    expect(result.current.hasAccess).toBe(false);
  });

  it("keeps a signed-out visitor out", async () => {
    const { result } = await accessFor("anonymous");
    expect(result.current.hasAccess).toBe(false);
  });

  it("keeps a content reviewer out", async () => {
    const { result } = await accessFor("content_reviewer");
    expect(result.current.hasAccess).toBe(false);
  });

  it("keeps out a bible reader who is also a content reviewer", async () => {
    // The interesting case, and the reason the rule is an AND NOT rather than
    // a plain role check: granting the reviewer role to someone who already
    // reads must revoke their access, not sit alongside it.
    const { result } = await accessFor("bible_reader", (backend) => {
      backend.db.add("user_roles", aRole("content_reviewer"));
    });
    expect(result.current.hasAccess).toBe(false);
  });

  it("lets an admin in even when they are also a content reviewer", async () => {
    // Admin wins outright — otherwise an admin could lock themselves out by
    // taking on a review shift.
    const { result } = await accessFor("admin", (backend) => {
      backend.db.add("user_roles", aRole("content_reviewer"));
    });
    expect(result.current.hasAccess).toBe(true);
  });
});

describe("when the check cannot be made", () => {
  it("denies access rather than assuming it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const harness = renderHookWithProviders(() => useBibleAccess(), {
      persona: "bible_reader",
      seed: (backend) => {
        backend.stubRpc("has_bible_access", () => {
          throw new Error("rpc unavailable");
        });
      },
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.loading).toBe(false));

    // Failing open would show the material to anyone whose check happened to
    // error — the one direction this gate must never fail in.
    expect(harness.result.current.hasAccess).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it("denies access when the answer is not a definite yes", async () => {
    const harness = renderHookWithProviders(() => useBibleAccess(), {
      persona: "bible_reader",
      seed: (backend) => backend.stubRpc("has_bible_access", null),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.loading).toBe(false));

    // `data === true`, not a truthiness check: null, undefined and "false" all
    // have to read as denied.
    expect(harness.result.current.hasAccess).toBe(false);
  });
});

describe("the loading flag", () => {
  it("stays true until the answer is known", async () => {
    const harness = renderHookWithProviders(() => useBibleAccess(), { persona: "bible_reader" });
    cleanup = harness.cleanup;

    // Callers render a denial while loading is false, so reporting "done"
    // before the check returns flashes "no access" at someone who has it.
    expect(harness.result.current.loading).toBe(true);
    await waitFor(() => expect(harness.result.current.loading).toBe(false));
  });

  it("settles for a signed-out visitor without asking the server", async () => {
    const { result, backend } = await accessFor("anonymous");

    expect(result.current.loading).toBe(false);
    expect(backend.rpcCallsTo("has_bible_access")).toHaveLength(0);
  });

  it("asks once per learner, not once per render", async () => {
    const { backend, rerender } = await accessFor("bible_reader");

    rerender();
    rerender();

    // The check is cached against the user id so a token refresh — which
    // produces a new session object — does not re-ask on every tick.
    await waitFor(() => expect(backend.rpcCallsTo("has_bible_access")).toHaveLength(1));
  });
});
