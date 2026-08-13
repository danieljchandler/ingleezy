import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SmartNotification } from "@/hooks/useSmartNotifications";
import { NotificationBell } from "./NotificationBell";

/**
 * The bell in the header.
 *
 * Nothing here is pushed — the notifications are derived from the learner's own
 * state (reviews falling due, a streak about to break) by `useSmartNotifications`,
 * which has its own tests. What this component owes them is triage: the count
 * has to be visible without opening anything, and a streak about to break has
 * to look different from a weekly summary, because the first is worth
 * interrupting for and the second is not.
 */

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => nav.navigate,
}));

const notifications = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/hooks/useSmartNotifications", () => ({
  useSmartNotifications: () => ({ data: notifications.data }),
}));

const aNotification = (over: Partial<SmartNotification> = {}): SmartNotification => ({
  id: "n-1",
  type: "review_due",
  title: "12 reviews are due",
  body: "Clear them before they pile up.",
  icon: "📚",
  actionUrl: "/review",
  priority: "medium",
  createdAt: new Date("2026-08-12T09:00:00"),
  ...over,
});

const URGENT = aNotification({
  id: "n-2",
  type: "streak_risk",
  title: "Your streak ends in 3 hours",
  body: "One review keeps it alive.",
  icon: "🔥",
  actionUrl: "/review",
  priority: "high",
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  nav.navigate.mockReset();
  notifications.data = [];
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(data: SmartNotification[] = []) {
  notifications.data = data;
  const view = rtlRender(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
  cleanup = view.unmount;
  return view;
}

const bell = () => screen.getByRole("button", { name: "Notifications" });
const badge = (container: HTMLElement) => container.querySelector(".rounded-full.text-\\[10px\\]");
const item = (title: string) => screen.getByRole("button", { name: `Notification: ${title}` });

describe("the badge", () => {
  it("shows nothing when there is nothing to say", () => {
    const { container } = render();

    // A permanent "0" trains the learner to ignore the bell.
    expect(badge(container)).toBeNull();
  });

  it("counts what is waiting", () => {
    const { container } = render([aNotification(), URGENT]);

    expect(badge(container)).toHaveTextContent("2");
  });

  it("shouts when one of them is urgent", () => {
    const { container } = render([aNotification(), URGENT]);

    // A streak about to break is worth interrupting for; a weekly summary is
    // not, and the same colour for both would flatten that.
    expect(badge(container)!.className).toContain("bg-destructive");
    expect(badge(container)!.className).toContain("animate-pulse");
  });

  it("stays quiet when nothing is urgent", () => {
    const { container } = render([aNotification()]);

    expect(badge(container)!.className).toContain("bg-primary");
    expect(badge(container)!.className).not.toContain("animate-pulse");
  });

  it("names the bell for a screen reader", () => {
    render([aNotification()]);

    // The count is inside the button, so it becomes the accessible name unless
    // an explicit label is set — "2" is not a useful thing to hear.
    expect(bell()).toHaveAccessibleName("Notifications");
  });
});

describe("opening the list", () => {
  it("stays shut until the bell is tapped", () => {
    render([aNotification()]);

    expect(screen.queryByText("Notifications", { selector: "h3" })).toBeNull();
  });

  it("opens on the bell", () => {
    render([aNotification()]);

    fireEvent.click(bell());

    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    expect(item("12 reviews are due")).toBeInTheDocument();
  });

  it("closes on a second tap", () => {
    render([aNotification()]);
    fireEvent.click(bell());

    fireEvent.click(bell());

    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
  });

  it("closes when something else on the page is pressed", () => {
    render([aNotification()]);
    fireEvent.click(bell());

    fireEvent.mouseDown(document.body);

    // It is a dropdown over the header; leaving it open while the learner works
    // underneath it covers the page.
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
  });

  it("stays open when the press lands inside it", () => {
    render([aNotification()]);
    fireEvent.click(bell());

    fireEvent.mouseDown(item("12 reviews are due"));

    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
  });

  it("stops listening once it is gone", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    render([aNotification()]);

    cleanup!();
    cleanup = undefined;

    // The listener is on the document; one left behind fires on every click in
    // the app for the rest of the session.
    expect(remove).toHaveBeenCalledWith("mousedown", expect.any(Function));
    remove.mockRestore();
  });

  it("can be opened with nothing in it", () => {
    render();

    fireEvent.click(bell());

    // Reachable: the badge is hidden but the bell is not, so an empty list has
    // to say something rather than open onto a blank panel.
    expect(screen.getByText("You're all caught up! 🎉")).toBeInTheDocument();
  });
});

describe("reading the notifications", () => {
  it("shows each one with its icon and detail", () => {
    render([aNotification()]);
    fireEvent.click(bell());

    expect(screen.getByText("12 reviews are due")).toBeInTheDocument();
    expect(screen.getByText("Clear them before they pile up.")).toBeInTheDocument();
    expect(screen.getByText("📚")).toBeInTheDocument();
  });

  it("marks the urgent one", () => {
    render([aNotification(), URGENT]);
    fireEvent.click(bell());

    // Two identical rows would need reading to triage; the badge and the tint
    // do it at a glance.
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(item("Your streak ends in 3 hours").className).toContain("bg-destructive/5");
    expect(item("12 reviews are due").className).not.toContain("bg-destructive/5");
  });

  it("does not mark an ordinary one", () => {
    render([aNotification()]);
    fireEvent.click(bell());

    expect(screen.queryByText("Urgent")).toBeNull();
  });

  it("keeps them in the order the hook gave them", () => {
    render([URGENT, aNotification()]);
    fireEvent.click(bell());

    // The hook decides the order; re-sorting here would put this component in
    // charge of priority twice, in two places.
    const titles = screen
      .getAllByRole("button")
      .slice(1)
      .map((b) => b.getAttribute("aria-label"));
    expect(titles).toEqual([
      "Notification: Your streak ends in 3 hours",
      "Notification: 12 reviews are due",
    ]);
  });
});

describe("acting on one", () => {
  it("goes where the notification points", () => {
    render([aNotification()]);
    fireEvent.click(bell());

    fireEvent.click(item("12 reviews are due"));

    // The whole point of the bell is being one tap from the thing it is about.
    expect(nav.navigate).toHaveBeenCalledWith("/review");
  });

  it("closes behind itself", () => {
    render([aNotification()]);
    fireEvent.click(bell());

    fireEvent.click(item("12 reviews are due"));

    // Landing on the review page with the dropdown still over it would cover
    // the first card.
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
  });

  it("just closes when there is nowhere to go", () => {
    render([aNotification({ title: "Level 5 reached", actionUrl: undefined })]);
    fireEvent.click(bell());

    fireEvent.click(item("Level 5 reached"));

    // An achievement is an announcement, not an errand.
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
  });
});

describe("when the hook has not answered yet", () => {
  it("shows a bell with no badge", () => {
    notifications.data = undefined as unknown as SmartNotification[];
    const { container } = rtlRender(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );
    cleanup = () => container.remove();

    // The derivation runs several queries; a badge that flickered in from
    // nothing on every page load would be worse than arriving late.
    expect(badge(container)).toBeNull();
    fireEvent.click(bell());
    expect(screen.getByText("You're all caught up! 🎉")).toBeInTheDocument();
  });
});
