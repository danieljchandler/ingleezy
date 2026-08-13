import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@/hooks/useCurriculumChat";
import { ChatSidebar } from "./ChatSidebar";

/**
 * The session list down the left of the curriculum builder.
 *
 * Building a lesson is a conversation that runs over days, and an admin has
 * several going at once — one per dialect, usually, since a session is pinned
 * to the dialect it targets. So each row has to carry enough to pick the right
 * one out of a list of twenty: what it was about, which dialect it was for, and
 * when it was last touched.
 */

const NOW = new Date("2026-03-10T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const daysBefore = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000).toISOString();

const aSession = (over: Partial<ChatSession> = {}): ChatSession => ({
  id: "sess-1",
  admin_id: "admin-1",
  title: "Greetings and introductions",
  target_dialect: "Gulf",
  target_stage_id: null,
  target_cefr: null,
  llm_model: "google/gemini-3.5-flash",
  status: "active",
  created_at: daysBefore(3),
  updated_at: daysBefore(0),
  ...over,
});

interface Options {
  sessions?: ChatSession[];
  activeSessionId?: string | null;
}

function renderSidebar({ sessions = [aSession()], activeSessionId = null }: Options = {}) {
  const onSelectSession = vi.fn();
  const onNewSession = vi.fn();
  const onArchiveSession = vi.fn();
  const result = render(
    <ChatSidebar
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSelectSession={onSelectSession}
      onNewSession={onNewSession}
      onArchiveSession={onArchiveSession}
    />,
  );
  return { ...result, onSelectSession, onNewSession, onArchiveSession };
}

/**
 * The session rows. They are divs given `role="button"` rather than real
 * buttons — filtering on the tag is what separates them from the New Session
 * and Archive buttons, which share the role.
 */
const rows = () => screen.getAllByRole("button").filter((el) => el.tagName === "DIV");

describe("ChatSidebar — with no sessions", () => {
  it("says the list is empty rather than showing nothing", () => {
    renderSidebar({ sessions: [] });
    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
    expect(screen.getByText(/Start a new session to begin building curriculum/)).toBeInTheDocument();
  });

  it("still offers the way to start one", () => {
    renderSidebar({ sessions: [] });
    expect(screen.getByRole("button", { name: /New Session/ })).toBeInTheDocument();
  });
});

describe("ChatSidebar — the rows", () => {
  it("shows each session's title", () => {
    renderSidebar({
      sessions: [aSession({ id: "a", title: "Greetings" }), aSession({ id: "b", title: "Haggling" })],
    });
    expect(screen.getByText("Greetings")).toBeInTheDocument();
    expect(screen.getByText("Haggling")).toBeInTheDocument();
  });

  it("keeps the order it was given", () => {
    // The hook sorts by recency; re-sorting here would fight it.
    renderSidebar({
      sessions: [aSession({ id: "a", title: "First" }), aSession({ id: "b", title: "Second" })],
    });
    expect(rows()[0]).toHaveTextContent("First");
  });

  it("truncates a long title rather than wrapping the row", () => {
    renderSidebar({ sessions: [aSession({ title: "x".repeat(200) })] });
    expect(screen.getByText("x".repeat(200))).toHaveClass("truncate");
  });

  it("names the dialect and flies its flag", () => {
    renderSidebar({ sessions: [aSession({ target_dialect: "Qatari" })] });
    expect(screen.getByText("🇶🇦 Qatari")).toBeInTheDocument();
  });

  it("marks the open session", () => {
    renderSidebar({
      sessions: [aSession({ id: "a" }), aSession({ id: "b" })],
      activeSessionId: "b",
    });
    expect(rows()[1].className).toContain("bg-primary/10");
    expect(rows()[0].className).not.toContain("bg-primary/10");
  });

  it("marks nothing when no session is open", () => {
    renderSidebar({ sessions: [aSession({ id: "a" })] });
    expect(rows()[0].className).not.toContain("bg-primary/10");
  });
});

describe("ChatSidebar — when each session was last touched", () => {
  it.each([
    [0, "Today"],
    [1, "Yesterday"],
    [3, "3d ago"],
    [6, "6d ago"],
  ])("describes %i days ago as %s", (days, label) => {
    renderSidebar({ sessions: [aSession({ updated_at: daysBefore(days) })] });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("falls back to a date once a week has passed", () => {
    // "34d ago" stops meaning anything; a date is something an admin can match
    // against their own notes.
    renderSidebar({ sessions: [aSession({ updated_at: daysBefore(34) })] });
    expect(screen.getByText(new Date(daysBefore(34)).toLocaleDateString())).toBeInTheDocument();
  });

  it("treats exactly seven days as old enough for a date", () => {
    renderSidebar({ sessions: [aSession({ updated_at: daysBefore(7) })] });
    expect(screen.queryByText("7d ago")).not.toBeInTheDocument();
  });

  it("describes a moment in the future as today", () => {
    // `updated_at` is written by Postgres and rendered against the browser's
    // clock, so a session saved seconds ago routinely comes back a moment in
    // the future — and Math.floor of a small negative difference is -1, which
    // is neither 0 nor 1 but is < 7, so the row said "-1d ago" for the session
    // the admin was working in right then.
    renderSidebar({
      sessions: [aSession({ updated_at: new Date(NOW.getTime() + 2000).toISOString() })],
    });
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.queryByText("-1d ago")).not.toBeInTheDocument();
  });

  it("gives an unknown dialect a placeholder flag", () => {
    // Sessions keep whatever dialect they were created under, so a dialect
    // retired from DIALECT_OPTIONS still has rows. Falling back to an empty
    // string rendered a leading space and then the name — subtly broken rather
    // than clearly legacy.
    renderSidebar({
      sessions: [aSession({ target_dialect: "Levantine" as ChatSession["target_dialect"] })],
    });
    expect(screen.getByText("🏳️ Levantine")).toBeInTheDocument();
  });
});

describe("ChatSidebar — opening a session", () => {
  it("opens the one that was clicked", () => {
    const { onSelectSession } = renderSidebar({
      sessions: [aSession({ id: "a" }), aSession({ id: "b" })],
    });
    fireEvent.click(rows()[1]);
    expect(onSelectSession).toHaveBeenCalledWith("b");
  });

  it("opens on Enter", () => {
    // The rows are divs, so the keyboard behaviour a real button would have has
    // to be written out — and it is, which is why this is worth pinning.
    const { onSelectSession } = renderSidebar({ sessions: [aSession({ id: "a" })] });
    fireEvent.keyDown(rows()[0], { key: "Enter" });
    expect(onSelectSession).toHaveBeenCalledWith("a");
  });

  it("opens on Space", () => {
    const { onSelectSession } = renderSidebar({ sessions: [aSession({ id: "a" })] });
    fireEvent.keyDown(rows()[0], { key: " " });
    expect(onSelectSession).toHaveBeenCalledWith("a");
  });

  it("ignores other keys", () => {
    const { onSelectSession } = renderSidebar({ sessions: [aSession({ id: "a" })] });
    fireEvent.keyDown(rows()[0], { key: "a" });
    fireEvent.keyDown(rows()[0], { key: "Tab" });
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("puts every row in the tab order", () => {
    renderSidebar({ sessions: [aSession({ id: "a" }), aSession({ id: "b" })] });
    expect(rows()).toHaveLength(2);
    expect(rows().every((row) => row.getAttribute("tabindex") === "0")).toBe(true);
  });

  it("starts a new session from the top button", () => {
    const { onNewSession } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /New Session/ }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });
});

describe("ChatSidebar — archiving", () => {
  const archiveButton = (n = 0) => screen.getAllByTitle("Archive session")[n];

  it("archives the session whose row it belongs to", () => {
    const { onArchiveSession } = renderSidebar({
      sessions: [aSession({ id: "a" }), aSession({ id: "b" })],
    });
    fireEvent.click(archiveButton(1));
    expect(onArchiveSession).toHaveBeenCalledWith("b");
  });

  it("does not open the session it is archiving", () => {
    // The button sits inside the clickable row, so without stopPropagation an
    // archive would also switch the admin into the conversation they just
    // filed away.
    const { onSelectSession, onArchiveSession } = renderSidebar();
    fireEvent.click(archiveButton());
    expect(onArchiveSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("shows itself to a keyboard user who tabs onto it", () => {
    // `opacity-0 group-hover:opacity-100` alone left a keyboard user tabbing
    // onto a control they could not see: it stayed in the tab order and stayed
    // clickable, with nothing to bring it back into view.
    renderSidebar();
    expect(archiveButton().className).toContain("focus-visible:opacity-100");
  });

  it("shows itself on a screen that has no hover at all", () => {
    // Touch has no hover state, so hiding behind it left no way to archive.
    renderSidebar();
    expect(archiveButton().className).toContain("[@media(hover:none)]:opacity-100");
  });

  it("still keeps out of the way of a pointer user", () => {
    renderSidebar();
    expect(archiveButton().className).toContain("opacity-0");
    expect(archiveButton().className).toContain("group-hover:opacity-100");
  });
});
