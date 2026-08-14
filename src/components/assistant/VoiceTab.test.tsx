import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { LiveStatus } from "@/hooks/useOpenAIRealtime";
import { VoiceTab } from "./VoiceTab";

/**
 * Voice mode of the Ask AI assistant. Three things are load-bearing: the
 * subscription gate (the server enforces it, but the UI must not dangle a
 * button that will 403), the context handed to `start` (the whole point of
 * this mode is that the tutor knows what's on screen), and teardown — an
 * unmounted tab must never leave a live, billing call running.
 *
 * The realtime plumbing is `useOpenAIRealtime`'s job and has its own tests.
 */

interface Turn {
  role: "user" | "assistant";
  text: string;
  partial?: boolean;
}

const live = vi.hoisted(() => ({
  status: "idle" as LiveStatus,
  error: null as string | null,
  turns: [] as Turn[],
  muted: false,
  remainingSeconds: null as number | null,
  setMuted: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/hooks/useOpenAIRealtime", () => ({
  useOpenAIRealtime: () => ({
    status: live.status,
    error: live.error,
    turns: live.turns,
    muted: live.muted,
    remainingSeconds: live.remainingSeconds,
    setMuted: live.setMuted,
    start: live.start,
    stop: live.stop,
  }),
}));

const subscription = vi.hoisted(() => ({ subscribed: false, loading: false }));

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscribed: subscription.subscribed,
    tier: subscription.subscribed ? "standard" : null,
    subscriptionEnd: null,
    loading: subscription.loading,
    checkSubscription: vi.fn(),
  }),
}));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  live.status = "idle";
  live.error = null;
  live.turns = [];
  live.muted = false;
  live.remainingSeconds = null;
  live.setMuted.mockReset();
  live.start.mockReset();
  live.stop.mockReset();
  subscription.subscribed = false;
  subscription.loading = false;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render({ signedIn = true, route = "/reading" }: { signedIn?: boolean; route?: string } = {}) {
  localStorage.setItem("ingleezy_dialect_module", "Gulf");
  const harness = renderWithProviders(<VoiceTab />, {
    persona: signedIn ? "free" : undefined,
    route,
  });
  cleanup = harness.cleanup;
  return harness;
}

describe("gating", () => {
  it("asks a signed-out visitor to sign in", async () => {
    render({ signedIn: false });
    expect(await screen.findByText(/سجّل دخولك عشان تكلّم/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ابدأ مكالمة صوتية" })).toBeNull();
  });

  it("shows the upgrade path to a free user instead of a dead button", () => {
    render();
    expect(screen.getByText(/ميزة مدفوعة/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "شوف الباقات" })).toHaveAttribute("href", "/pricing");
    expect(screen.queryByRole("button", { name: "ابدأ مكالمة صوتية" })).toBeNull();
  });
});

describe("the call", () => {
  beforeEach(() => {
    subscription.subscribed = true;
  });

  it("waits for an explicit start and hands over the page context", async () => {
    render({ route: "/reading" });

    // No auto-start: a voice call costs per minute.
    expect(live.start).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ابدأ مكالمة صوتية" }));
    });

    expect(live.start).toHaveBeenCalledTimes(1);
    const args = live.start.mock.calls[0][0];
    expect(args.mode).toBe("assistant");
    expect(args.dialect).toBe("Gulf");
    // The route is unregistered here, so the PAGE_HINTS fallback describes it.
    expect(args.context).toContain("تدريب القراءة");
  });

  it("shows the transcript with speaker labels while live", () => {
    live.status = "live";
    live.turns = [
      { role: "user", text: "what does yalla mean?" },
      { role: "assistant", text: "يالله means let's go", partial: false },
    ];
    render();

    expect(screen.getByText("أنت")).toBeInTheDocument();
    expect(screen.getByText("المدرّب")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "اكتم المايك" })).toBeInTheDocument();
  });

  it("ends the call on demand and on unmount", async () => {
    live.status = "live";
    const harness = render();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "أنهِ المكالمة" }));
    });
    expect(live.stop).toHaveBeenCalledTimes(1);

    harness.unmount();
    // Teardown must also fire when the panel closes around us.
    expect(live.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces connection errors instead of a silent dead call", () => {
    live.status = "error";
    live.error = "Voice connection failed";
    render();

    expect(screen.getByText("Voice connection failed")).toBeInTheDocument();
  });

  it("shows the monthly minute balance once the server has reported one", () => {
    live.remainingSeconds = 754; // 12.6 minutes — floor, don't round up
    render();

    // The balance doubles as the upgrade prompt: a learner watching it run
    // down knows why the next tier exists.
    expect(screen.getByText(/باقي لك 12 دقيقة هذا الشهر/)).toBeInTheDocument();
  });

  it("says nothing about minutes before a call has been attempted", () => {
    live.remainingSeconds = null;
    render();

    expect(screen.queryByText(/دقيقة هذا الشهر/)).not.toBeInTheDocument();
  });
});
