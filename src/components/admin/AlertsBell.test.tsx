import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { alertId, anAlert, TEST_USER_ID } from "@/test/support/factories";
import { supabase } from "@/integrations/supabase/client";
import AlertsBell from "./AlertsBell";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The alert bell that follows an admin around the admin area.
 *
 * The metrics job writes a row to `feature_alerts` when a feature's error rate
 * or latency crosses a threshold. Nobody watches a dashboard, so the bell is
 * how anyone finds out — and because an alert is only useful while it is still
 * happening, it arrives over realtime and pops a toast rather than waiting for
 * the next page load.
 *
 * Acknowledging is the other half. An alert that stays up after somebody has
 * dealt with it trains everyone to ignore the bell, so acknowledging clears it
 * everywhere: for this admin immediately, and for any other admin with the page
 * open through the same realtime channel.
 */

// The realtime transport is a WebSocket the in-memory backend does not serve.
// Standing in for the channel keeps the test hermetic and puts the component's
// own wiring — which events it asks for, and what it does with a payload —
// under test instead of supabase-js's socket.
type Handler = (payload: { new: Record<string, unknown> }) => void;
const realtime = { handlers: new Map<string, Handler>() };

const notifications = vi.hoisted(() => ({
  permission: "default" as NotificationPermission,
  requested: vi.fn(),
  created: [] as Array<{ title: string; options?: NotificationOptions }>,
}));

const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toasts.error(...a), success: vi.fn() },
}));

let cleanup: (() => void) | undefined;
let unmount: (() => void) | undefined;

beforeEach(() => {
  realtime.handlers = new Map();
  toasts.error.mockReset();
  notifications.permission = "granted";
  notifications.requested.mockReset().mockResolvedValue("granted");
  notifications.created = [];

  const channel = {
    on: (_type: string, filter: { event: string }, handler: Handler) => {
      realtime.handlers.set(filter.event, handler);
      return channel;
    },
    subscribe: () => channel,
    unsubscribe: async () => "ok",
  };
  vi.spyOn(supabase, "channel").mockReturnValue(channel as never);
  vi.spyOn(supabase, "removeChannel").mockResolvedValue("ok" as never);

  class FakeNotification {
    static get permission() {
      return notifications.permission;
    }
    static requestPermission = notifications.requested;
    constructor(title: string, options?: NotificationOptions) {
      notifications.created.push({ title, options });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  // Unmount before the spies go: the component's cleanup calls removeChannel,
  // and the real one would try to unsubscribe the stand-in channel.
  unmount?.();
  unmount = undefined;
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderWithProviders(<AlertsBell />, {
    persona: "admin",
    seed,
  });
  cleanup = harness.cleanup;
  unmount = harness.unmount;
  return harness;
}

const AN_ALERT = anAlert();

const seedAlerts = (rows: Record<string, unknown>[]) => (backend: SupabaseBackend) =>
  backend.db.seed("feature_alerts", rows);

// The button's accessible name becomes the badge count as soon as there is
// one, so the stable handle is its title.
const bell = () => screen.getByTitle("Feature alerts");
const openPanel = () => fireEvent.click(bell());
const emit = (event: "INSERT" | "UPDATE", row: Record<string, unknown>) =>
  act(() => {
    realtime.handlers.get(event)?.({ new: row });
  });

describe("what the bell shows", () => {
  it("sits quiet when nothing is wrong", async () => {
    render();

    await waitFor(() => expect(bell()).toBeInTheDocument());
    expect(bell().className).toContain("bg-slate-700");
    expect(bell().textContent).toBe("");
  });

  it("counts the alerts that are still open", async () => {
    render(seedAlerts([AN_ALERT, anAlert({ id: alertId(1), message: "Second" })]));

    await waitFor(() => expect(bell().textContent).toBe("2"));
  });

  it("stops counting at fifty however many there are", async () => {
    render(
      seedAlerts(
        Array.from({ length: 100 }, (_, index) =>
          anAlert({ id: alertId(index), message: `Alert ${index}` }),
        ),
      ),
    );

    // Pinned: the badge has a "99+" form for a flood, and it cannot be reached.
    // The query takes fifty and the realtime handler trims back to fifty, so a
    // night that fired three hundred alerts reads as fifty — the badge stops
    // distinguishing "a bad night" from "everything is on fire".
    await waitFor(() => expect(bell().textContent).toBe("50"));
  });

  it("takes its colour from the worst alert, not the newest", async () => {
    render(
      seedAlerts([
        anAlert({ id: alertId(0), severity: "warn" }),
        anAlert({ id: alertId(1), severity: "critical", message: "Everything is down" }),
      ]),
    );

    // A critical alert behind a warning is exactly the case where an amber bell
    // would get left until tomorrow.
    await waitFor(() => expect(bell().className).toContain("animate-pulse"));
  });
});

describe("which alerts it asks for", () => {
  it("leaves out the ones somebody has already dealt with", async () => {
    const { backend } = render(seedAlerts([AN_ALERT]));

    await waitFor(() => expect(backend.db.reads.length).toBeGreaterThan(0));
    const read = backend.db.reads.find((r) => r.table === "feature_alerts")!;
    // An acknowledged alert reappearing on the next page load is how a bell
    // becomes background noise.
    expect(read.search).toContain("acknowledged_at=is.null");
  });

  it("looks back only a day", async () => {
    const { backend } = render(seedAlerts([AN_ALERT]));

    await waitFor(() => expect(backend.db.reads.length).toBeGreaterThan(0));
    // Something that broke last week and was never acknowledged is history,
    // not an alert.
    expect(backend.db.reads.find((r) => r.table === "feature_alerts")!.search).toContain(
      "created_at=gte.",
    );
  });

  it("takes the newest first and stops at fifty", async () => {
    const { backend } = render(seedAlerts([AN_ALERT]));

    await waitFor(() => expect(backend.db.reads.length).toBeGreaterThan(0));
    const read = backend.db.reads.find((r) => r.table === "feature_alerts")!;
    expect(read.search).toContain("order=created_at.desc");
    expect(read.search).toContain("limit=50");
  });
});

describe("reading the list", () => {
  it("stays shut until the bell is pressed", async () => {
    render(seedAlerts([AN_ALERT]));
    await waitFor(() => expect(bell().textContent).toBe("1"));

    expect(screen.queryByText(AN_ALERT.message as string)).toBeNull();
  });

  it("shows each alert with where it came from", async () => {
    render(seedAlerts([AN_ALERT]));
    await waitFor(() => expect(bell().textContent).toBe("1"));

    openPanel();

    // The feature and dialect are what turn "error rate up" into somewhere to
    // look.
    expect(screen.getByText(AN_ALERT.message as string)).toBeInTheDocument();
    expect(screen.getByText(/translate · Gulf ·/)).toBeInTheDocument();
  });

  it("says an alert covers every dialect when it names none", async () => {
    render(seedAlerts([anAlert({ dialect: null })]));
    await waitFor(() => expect(bell().textContent).toBe("1"));

    openPanel();

    expect(screen.getByText(/translate · all ·/)).toBeInTheDocument();
  });

  it("says so plainly when there is nothing to see", async () => {
    render();
    await waitFor(() => expect(bell()).toBeInTheDocument());

    openPanel();

    expect(screen.getByText("No active alerts 🎉")).toBeInTheDocument();
  });

  it("offers the metrics page and closes on the way", async () => {
    render(seedAlerts([AN_ALERT]));
    await waitFor(() => expect(bell().textContent).toBe("1"));
    openPanel();

    const link = screen.getByRole("link", { name: /view metrics/i });
    expect(link).toHaveAttribute("href", "/admin/metrics");
    fireEvent.click(link);

    // The panel is a floating overlay; leaving it open over the page it just
    // navigated to would cover the thing the admin went to look at.
    expect(screen.queryByText("Alerts (1)")).toBeNull();
  });
});

describe("acknowledging", () => {
  it("records who cleared it and when", async () => {
    const { backend } = render(seedAlerts([AN_ALERT]));
    await waitFor(() => expect(bell().textContent).toBe("1"));
    openPanel();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Acknowledge"));
    });

    await waitFor(() => expect(backend.db.lastWriteTo("feature_alerts")).toBeTruthy());
    // Who dealt with it matters as much as that somebody did: the next person
    // to see the metrics page needs to know who to ask.
    expect(backend.db.lastWriteTo("feature_alerts")!.payload[0]).toMatchObject({
      acknowledged_by: TEST_USER_ID,
    });
    expect(backend.db.lastWriteTo("feature_alerts")!.payload[0].acknowledged_at).toBeTruthy();
  });

  it("takes it off the list straight away", async () => {
    render(seedAlerts([AN_ALERT]));
    await waitFor(() => expect(bell().textContent).toBe("1"));
    openPanel();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Acknowledge"));
    });

    await waitFor(() => expect(bell().textContent).toBe(""));
  });

  it("clears the lot in one go", async () => {
    const { backend } = render(
      seedAlerts([AN_ALERT, anAlert({ id: alertId(1), message: "Second" })]),
    );
    await waitFor(() => expect(bell().textContent).toBe("2"));
    openPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ack all/i }));
    });

    // A metrics job that fired forty times overnight is one incident, not
    // forty acknowledgements.
    await waitFor(() => expect(screen.getByText("No active alerts 🎉")).toBeInTheDocument());
    expect(backend.db.lastWriteTo("feature_alerts")!.affected).toHaveLength(2);
  });

  it("offers nothing to clear when the list is empty", async () => {
    render();
    await waitFor(() => expect(bell()).toBeInTheDocument());
    openPanel();

    expect(screen.queryByRole("button", { name: /ack all/i })).toBeNull();
  });
});

describe("alerts arriving while the page is open", () => {
  it("adds a new one to the top and says so", async () => {
    render(seedAlerts([AN_ALERT]));
    await waitFor(() => expect(bell().textContent).toBe("1"));

    emit("INSERT", anAlert({ id: alertId(9), message: "Listen latency spiking" }));

    // Nobody watches the dashboard. The toast is how anyone finds out while it
    // is still happening.
    expect(bell().textContent).toBe("2");
    expect(toasts.error).toHaveBeenCalledWith(
      "Listen latency spiking",
      expect.objectContaining({ description: "translate • Gulf • error" }),
    );
  });

  it("leaves a critical alert on screen longer", async () => {
    render();
    await waitFor(() => expect(bell()).toBeInTheDocument());

    emit("INSERT", anAlert({ id: alertId(9), severity: "critical", message: "All down" }));

    expect(toasts.error).toHaveBeenCalledWith(
      "All down",
      expect.objectContaining({ duration: 15000 }),
    );
  });

  it("ignores an alert it is already showing", async () => {
    render(seedAlerts([AN_ALERT]));
    await waitFor(() => expect(bell().textContent).toBe("1"));

    emit("INSERT", AN_ALERT);

    // The initial load and the realtime stream overlap; without the guard every
    // alert open at page load would be counted twice and toasted again.
    expect(bell().textContent).toBe("1");
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("drops an alert another admin acknowledged", async () => {
    render(seedAlerts([AN_ALERT]));
    await waitFor(() => expect(bell().textContent).toBe("1"));

    emit("UPDATE", { ...AN_ALERT, acknowledged_at: new Date().toISOString() });

    // Two admins working the same incident should not both have to clear it.
    await waitFor(() => expect(bell().textContent).toBe(""));
  });

  it("keeps an alert whose update was not an acknowledgement", async () => {
    render(seedAlerts([AN_ALERT]));
    await waitFor(() => expect(bell().textContent).toBe("1"));

    emit("UPDATE", { ...AN_ALERT, message: "Reworded" });

    expect(bell().textContent).toBe("1");
  });
});

describe("desktop notifications", () => {
  it("asks for permission the first time an admin opens the page", async () => {
    notifications.permission = "default";
    render();

    await waitFor(() => expect(notifications.requested).toHaveBeenCalled());
  });

  it("does not ask again once the admin has answered", async () => {
    notifications.permission = "denied";
    render();

    await waitFor(() => expect(bell()).toBeInTheDocument());
    // Asking on every page load is how a permission prompt gets denied for good.
    expect(notifications.requested).not.toHaveBeenCalled();
  });

  it("raises one for an alert that arrives while the tab is in the background", async () => {
    render();
    await waitFor(() => expect(bell()).toBeInTheDocument());

    emit("INSERT", anAlert({ id: alertId(9), message: "Listen latency spiking" }));

    // A toast on a tab nobody is looking at is not an alert.
    expect(notifications.created).toEqual([
      {
        title: "Hakiya alert: translate",
        options: { body: "Listen latency spiking", tag: alertId(9) },
      },
    ]);
  });

  it("stays with the toast when notifications were refused", async () => {
    notifications.permission = "denied";
    render();
    await waitFor(() => expect(bell()).toBeInTheDocument());

    emit("INSERT", anAlert({ id: alertId(9), message: "Listen latency spiking" }));

    expect(notifications.created).toEqual([]);
    expect(toasts.error).toHaveBeenCalled();
  });
});

describe("leaving the admin area", () => {
  it("closes the realtime channel", async () => {
    const { unmount } = render();
    await waitFor(() => expect(bell()).toBeInTheDocument());

    unmount();

    // The bell is mounted per admin page; a channel left open on every
    // navigation would accumulate for the length of the session.
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});
