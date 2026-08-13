import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useSubscription } from "./useSubscription";

/**
 * The learner's plan, and the two Stripe round-trips around it.
 *
 * Untestable before the in-memory backend implemented edge functions: the old
 * double returned `{}` for check-subscription, so every user resolved to
 * free-tier and neither the polling nor the checkout flow could be exercised.
 *
 * Worth noting what this hook is *not* doing: nothing in the app consumes
 * `hasAccess` — the tier gate is declared and unwired — so today this drives
 * only the Pricing and Settings pages. These tests describe the hook's own
 * contract so that wiring it up later is a change to the callers, not a
 * rediscovery of how it behaves.
 */

let cleanup: (() => void) | undefined;
let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openSpy = vi.fn();
  vi.stubGlobal("open", openSpy);
});

afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Wait for the real subscription check to land.
 *
 * Not `loading === false`: the hook flips that on its first pass, when
 * `useAuth` has not yet produced a session and the check short-circuits to
 * unsubscribed. Waiting on it would assert against that placeholder rather than
 * the answer, and every subscriber would look free-tier.
 */
async function settled(
  rendered: { result: { current: { loading: boolean } }; backend: { callsTo: (name: string) => unknown[] } },
  { expectCall = true }: { expectCall?: boolean } = {},
) {
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  if (expectCall) {
    await waitFor(() => expect(rendered.backend.callsTo("check-subscription").length).toBeGreaterThan(0));
  }
}

describe("resolving the plan", () => {
  it("reports a free learner as unsubscribed", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "free" });
    cleanup = rendered.cleanup;

    await settled(rendered);
    expect(rendered.result.current.subscribed).toBe(false);
    expect(rendered.result.current.tier).toBeNull();
  });

  it("reports a standard subscriber", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "standard" });
    cleanup = rendered.cleanup;

    await settled(rendered);
    expect(rendered.result.current.subscribed).toBe(true);
    expect(rendered.result.current.tier).toBe("standard");
  });

  it("reports an all-in subscriber", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "allin" });
    cleanup = rendered.cleanup;

    await settled(rendered);
    expect(rendered.result.current.tier).toBe("allin");
  });

  it("does not ask at all when signed out", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    await settled(rendered, { expectCall: false });
    expect(rendered.result.current.subscribed).toBe(false);
    expect(rendered.backend.callsTo("check-subscription")).toHaveLength(0);
  });

  it("treats a failed check as unsubscribed rather than hanging", async () => {
    // Failing open would hand paid features to anyone whose check errored;
    // hanging would leave the Pricing page on a spinner forever.
    const rendered = renderHookWithProviders(() => useSubscription(), {
      persona: "standard",
      seed: (backend) => backend.stubFunctionFailure("check-subscription", 500),
    });
    cleanup = rendered.cleanup;

    await settled(rendered);
    expect(rendered.result.current.subscribed).toBe(false);
  });
});

describe("tier access", () => {
  it("gives a free learner nothing above free", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "free" });
    cleanup = rendered.cleanup;

    await settled(rendered);
    // hasAccess only knows the two paid tiers; "free" is the absence of a plan.
    expect(rendered.result.current.hasAccess("standard")).toBe(false);
    expect(rendered.result.current.hasAccess("allin")).toBe(false);
  });

  it("gives a standard subscriber standard but not all-in", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "standard" });
    cleanup = rendered.cleanup;

    await settled(rendered);
    expect(rendered.result.current.hasAccess("standard")).toBe(true);
    expect(rendered.result.current.hasAccess("allin")).toBe(false);
  });

  it("gives an all-in subscriber everything, since allin outranks standard", async () => {
    // The tiers are ordered, not a set of independent flags — an all-in
    // subscriber must not be refused a standard feature.
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "allin" });
    cleanup = rendered.cleanup;

    await settled(rendered);
    expect(rendered.result.current.hasAccess("standard")).toBe(true);
    expect(rendered.result.current.hasAccess("allin")).toBe(true);
  });
});

describe("checkout", () => {
  it("opens the Stripe session in a new tab", async () => {
    // A same-tab redirect would lose any unsaved state on the page the learner
    // was on.
    const rendered = renderHookWithProviders(() => useSubscription(), {
      persona: "free",
      seed: (backend) =>
        backend.stubFunction("create-checkout", { url: "https://checkout.stripe.test/session" }),
    });
    cleanup = rendered.cleanup;

    await settled(rendered);
    await rendered.result.current.createCheckout("standard");

    expect(openSpy).toHaveBeenCalledWith("https://checkout.stripe.test/session", "_blank");
  });

  it("tells the function which plan was chosen", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), {
      persona: "free",
      seed: (backend) =>
        backend.stubFunction("create-checkout", { url: "https://checkout.stripe.test/session" }),
    });
    cleanup = rendered.cleanup;

    await settled(rendered);
    await rendered.result.current.createCheckout("allin");

    expect(rendered.backend.lastCallTo("create-checkout")?.body).toMatchObject({ tier: "allin" });
  });

  it("refuses when signed out rather than opening a broken session", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    await settled(rendered, { expectCall: false });
    await expect(rendered.result.current.createCheckout("standard")).rejects.toThrow(
      /logged in/i,
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("surfaces a failure instead of opening nothing", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), {
      persona: "free",
      seed: (backend) => backend.stubFunctionFailure("create-checkout", 500),
    });
    cleanup = rendered.cleanup;

    await settled(rendered);
    await expect(rendered.result.current.createCheckout("standard")).rejects.toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("the customer portal", () => {
  it("opens in a new tab", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), {
      persona: "standard",
      seed: (backend) =>
        backend.stubFunction("customer-portal", { url: "https://billing.stripe.test/portal" }),
    });
    cleanup = rendered.cleanup;

    await settled(rendered);
    await rendered.result.current.openCustomerPortal();

    expect(openSpy).toHaveBeenCalledWith("https://billing.stripe.test/portal", "_blank");
  });

  it("refuses when signed out", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    await settled(rendered, { expectCall: false });
    await expect(rendered.result.current.openCustomerPortal()).rejects.toThrow(/logged in/i);
  });
});

describe("the sixty-second refresh", () => {
  /**
   * Fake timers are installed before the render, not inside the test body.
   *
   * The interval is created during the hook's first effect, and swapping the
   * timers afterwards does not take over one that already exists. Mocking
   * `setInterval` outright is not an option either — Testing Library's
   * `waitFor` uses it, so the mock silently breaks every wait in the test.
   *
   * `shouldAdvanceTime` keeps the clock moving on its own, so the hook's async
   * work still resolves while the timers are fake.
   */
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("notices a plan bought in the Stripe tab", async () => {
    // Checkout opens in another tab, so nothing navigates back here — the poll
    // is the only way this page learns the plan changed.
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "free" });
    cleanup = rendered.cleanup;

    await settled(rendered);
    expect(rendered.result.current.subscribed).toBe(false);

    rendered.backend.stubFunction("check-subscription", {
      subscribed: true,
      tier: "standard",
      product_id: "prod_fixture",
      subscription_end: null,
    });

    // Inside act: advancing the clock fires the poll, and the state update it
    // causes belongs to this test rather than to whatever runs next.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await waitFor(() => expect(rendered.result.current.subscribed).toBe(true));
    expect(rendered.result.current.tier).toBe("standard");
  });

  it("does not poll when signed out", async () => {
    const rendered = renderHookWithProviders(() => useSubscription(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    await settled(rendered, { expectCall: false });
    await vi.advanceTimersByTimeAsync(120_000);

    expect(rendered.backend.callsTo("check-subscription")).toHaveLength(0);
  });
});
