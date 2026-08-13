import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useBetaTester } from "./useBetaTester";
import type { Persona } from "@/test/support/personas";

/**
 * Whether the in-app feedback widget appears.
 *
 * It is the app's only channel for "this lesson is wrong" or "the recorder did
 * not start", and it is deliberately not shown to everyone: unfiltered feedback
 * from every learner is a queue nobody reads, while feedback from the handful
 * of people who agreed to test is the thing that actually gets fixed.
 *
 * The check is a database function rather than a column, because the answer is
 * "beta tester *or* admin" and that is a rule worth keeping in one place. Which
 * means the whole hook is one round trip, and what it does while that trip is in
 * flight — and when it fails — is the entire behaviour.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(persona: Persona) {
  const harness = renderHookWithProviders(() => useBetaTester(), { persona });
  cleanup = harness.cleanup;
  return harness;
}

describe("who sees the feedback widget", () => {
  it("shows it to a beta tester", async () => {
    const { result } = render("beta_tester");

    await waitFor(() => expect(result.current.isBetaTester).toBe(true));
  });

  it("shows it to an admin", async () => {
    const { result } = render("admin");

    // Admins are testers by default — they are the ones acting on what comes
    // in, and needing a second role to file a report is friction for no reason.
    await waitFor(() => expect(result.current.isBetaTester).toBe(true));
  });

  it("hides it from an ordinary learner", async () => {
    const { result } = render("free");

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isBetaTester).toBe(false);
  });

  it("hides it from a paying subscriber who is not a tester", async () => {
    const { result } = render("allin");

    // Paying for the app is not the same as volunteering to report on it.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isBetaTester).toBe(false);
  });
});

describe("while the answer is unknown", () => {
  it("starts hidden rather than flashing the widget", async () => {
    const { result } = render("beta_tester");

    // The first render says no. Defaulting the other way would pop a floating
    // feedback button onto every learner's screen for a moment on every load.
    expect(result.current.isBetaTester).toBe(false);
    await waitFor(() => expect(result.current.isBetaTester).toBe(true));
  });

  it("reports that it has finished before it has started", async () => {
    const seen: Array<{ loading: boolean; isBetaTester: boolean }> = [];
    const harness = renderHookWithProviders(
      () => {
        const state = useBetaTester();
        seen.push({ ...state });
        return state;
      },
      { persona: "beta_tester" },
    );
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isBetaTester).toBe(true));

    // Pinned. The `loading` flag exists so a caller can render nothing rather
    // than render "not a tester" and correct itself a moment later. It does not
    // achieve that: `useAuth` has no user on the first pass, so the effect takes
    // its signed-out branch and sets loading to false immediately. A caller
    // waiting on `!loading` is told the answer is settled and negative, and the
    // widget still appears afterwards — the exact flash the flag was added to
    // prevent.
    expect(seen[0]).toEqual({ loading: true, isBetaTester: false });
    expect(seen.some((state) => !state.loading && !state.isBetaTester)).toBe(true);
    expect(seen.at(-1)).toEqual({ loading: false, isBetaTester: true });
  });

  it("settles for a signed-out visitor without asking", async () => {
    const { result, backend } = render("anonymous");

    // There is no user to check, and `is_beta_tester` under the anon role
    // would answer false after a pointless round trip on every page load.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isBetaTester).toBe(false);
    expect(backend.rpcCallsTo("is_beta_tester")).toEqual([]);
  });
});

describe("when the check fails", () => {
  it("hides the widget rather than guessing", async () => {
    const harness = renderHookWithProviders(() => useBetaTester(), {
      persona: "beta_tester",
      seed: (backend) => backend.db.failRpc("is_beta_tester", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    // Failing closed is right for a gate, and the cost is only that one tester
    // loses the button until they reload.
    await waitFor(() => expect(harness.result.current.loading).toBe(false));
    expect(harness.result.current.isBetaTester).toBe(false);
  });
});
