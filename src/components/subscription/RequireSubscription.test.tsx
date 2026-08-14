import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { PremiumFeature } from "@/lib/featureAccess";
import { RequireSubscription } from "./RequireSubscription";

/**
 * The paywall.
 *
 * Eight features sit behind this component, four at Standard and four at
 * All-In, and it is the only thing standing between a free account and any of
 * them. Two mistakes matter in opposite directions: showing the paid feature to
 * someone who has not paid, and showing the paywall to someone who has. The
 * second is why the loading branch exists at all — flashing either answer while
 * the subscription is still resolving is worse than showing neither.
 *
 * `useSubscription` is stood in for. It has its own tests, and driving Stripe
 * state through the backend here would obscure the only decision this component
 * makes.
 */

const subscription = vi.hoisted(() => ({
  loading: false,
  tier: "free" as "free" | "standard" | "allin",
}));

const RANK = { free: 0, standard: 1, allin: 2 } as const;

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({
    loading: subscription.loading,
    // The real hook compares tiers by rank; anything cheaper than the
    // requirement fails.
    hasAccess: (required: "standard" | "allin") =>
      RANK[subscription.tier] >= RANK[required],
  }),
}));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  subscription.loading = false;
  subscription.tier = "free";
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  feature?: PremiumFeature;
  tier?: "free" | "standard" | "allin";
  loading?: boolean;
  fallback?: React.ReactNode;
  persona?: "anonymous" | "free";
}

async function render({
  feature = "transcribe",
  tier = "free",
  loading = false,
  fallback,
  persona = "free",
}: Options = {}) {
  subscription.tier = tier;
  subscription.loading = loading;
  const harness = renderWithProviders(
    <RequireSubscription feature={feature} fallback={fallback}>
      <p>the paid feature</p>
    </RequireSubscription>,
    { persona },
  );
  cleanup = harness.cleanup;
  // useAuth resolves the session a tick after mount, and the paywall's button
  // label depends on it — assert after that has landed, not across it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return harness;
}

const paidFeature = () => screen.queryByText("the paid feature");

describe("RequireSubscription — while the plan is still being resolved", () => {
  it("shows neither the feature nor the paywall", async () => {
    // Flashing the paywall at a paying subscriber for one frame is the bug this
    // branch exists to prevent.
    const { container } = await render({ loading: true, tier: "allin" });
    expect(paidFeature()).not.toBeInTheDocument();
    expect(screen.queryByText(/ميزة مدفوعة$/)).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows the spinner even for a free account", async () => {
    const { container } = await render({ loading: true, tier: "free" });
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("ignores a caller's fallback while loading", async () => {
    await render({ loading: true, fallback: <p>custom fallback</p> });
    expect(screen.queryByText("custom fallback")).not.toBeInTheDocument();
  });
});

describe("RequireSubscription — letting a subscriber through", () => {
  it("shows a Standard feature to a Standard subscriber", async () => {
    await render({ feature: "transcribe", tier: "standard" });
    expect(paidFeature()).toBeInTheDocument();
  });

  it("shows a Standard feature to an All-In subscriber", async () => {
    // The tiers are a ladder, not a set of separate products.
    await render({ feature: "transcribe", tier: "allin" });
    expect(paidFeature()).toBeInTheDocument();
  });

  it("shows an All-In feature to an All-In subscriber", async () => {
    await render({ feature: "unlimited_vocab", tier: "allin" });
    expect(paidFeature()).toBeInTheDocument();
  });

  it("shows no paywall alongside the feature", async () => {
    await render({ feature: "transcribe", tier: "standard" });
    expect(screen.queryByRole("link", { name: /شوف الباقات|سجّل حساب/ })).not.toBeInTheDocument();
  });
});

describe("RequireSubscription — holding a non-subscriber back", () => {
  it("hides a Standard feature from a free account", async () => {
    await render({ feature: "transcribe", tier: "free" });
    expect(paidFeature()).not.toBeInTheDocument();
  });

  it("hides an All-In feature from a Standard subscriber", async () => {
    // The commonest real case: someone has paid, just not for this.
    await render({ feature: "unlimited_vocab", tier: "standard" });
    expect(paidFeature()).not.toBeInTheDocument();
  });

  it("names the feature being asked for", async () => {
    await render({ feature: "meme_analyzer", tier: "free" });
    expect(screen.getByText("محلل الميمز ميزة مدفوعة")).toBeInTheDocument();
  });

  it.each([
    ["transcribe", "أداة التفريغ"],
    ["how_do_i_say", "ميزة «كيف أقول…؟»"],
    ["learn_from_x", "التعلّم من منشورات X"],
    ["full_discover", "مكتبة اكتشف كاملة"],
    ["priority_ai", "أولوية معالجة الذكاء الاصطناعي"],
    ["early_access", "الوصول المبكر للميزات"],
  ] as const)("labels %s properly", async (feature, label) => {
    await render({ feature, tier: "free" });
    expect(screen.getByText(`${label} ميزة مدفوعة`)).toBeInTheDocument();
  });

  it("says which plan would unlock a Standard feature", async () => {
    await render({ feature: "transcribe", tier: "free" });
    expect(screen.getByText("اشترك في Standard أو All-In عشان تفتحها.")).toBeInTheDocument();
  });

  it("says which plan would unlock an All-In feature", async () => {
    // Telling a Standard subscriber to "subscribe" would be wrong — they have.
    await render({ feature: "priority_ai", tier: "standard" });
    expect(screen.getByText("رقّي لباقة All-In عشان تفتحها.")).toBeInTheDocument();
  });

  it("marks an All-In feature with the crown", async () => {
    const { container } = await render({ feature: "priority_ai", tier: "free" });
    expect(container.querySelector(".lucide-crown")).toBeInTheDocument();
  });

  it("marks a Standard feature with the padlock", async () => {
    const { container } = await render({ feature: "transcribe", tier: "free" });
    expect(container.querySelector(".lucide-lock")).toBeInTheDocument();
  });

  it("offers the way to the plans", async () => {
    await render({ feature: "transcribe", tier: "free" });
    expect(screen.getByRole("link", { name: "شوف الباقات" })).toHaveAttribute("href", "/pricing");
  });

  it("asks a signed-out visitor to sign up instead", async () => {
    // "شوف الباقات" implies an account to attach one to; a visitor needs the
    // earlier step named.
    await render({ feature: "transcribe", tier: "free", persona: "anonymous" });
    expect(screen.getByRole("link", { name: "سجّل حساب" })).toHaveAttribute("href", "/pricing");
  });
});

describe("RequireSubscription — a caller's own fallback", () => {
  it("replaces the paywall card", async () => {
    await render({ tier: "free", fallback: <p>custom fallback</p> });
    expect(screen.getByText("custom fallback")).toBeInTheDocument();
    expect(screen.queryByText(/ميزة مدفوعة$/)).not.toBeInTheDocument();
  });

  it("is not shown to a subscriber", async () => {
    await render({ tier: "standard", fallback: <p>custom fallback</p> });
    expect(paidFeature()).toBeInTheDocument();
    expect(screen.queryByText("custom fallback")).not.toBeInTheDocument();
  });

  it("still gates the feature", async () => {
    // A fallback changes what the refusal looks like, never whether it happens.
    await render({ tier: "free", fallback: <p>custom fallback</p> });
    expect(paidFeature()).not.toBeInTheDocument();
  });
});
