import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { LevelJourneyCard, RECHECK_AFTER_DAYS } from "./LevelJourneyCard";

/**
 * The assessed-level card. What matters: it only ever charts SERVER history
 * (the hook fetches, never composes), it filters to the active dialect, it
 * celebrates a measured move up, and the re-check nudge appears exactly when
 * the latest assessment goes stale — that nudge is the whole "recurring" in
 * recurring placement.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));
vi.mock("@/contexts/DialectContext", () => ({
  useDialect: () => ({ activeDialect: "Gulf" }),
}));

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const row = (over: Record<string, unknown> = {}) => ({
  dialect: "Gulf",
  cefr_level: "B1",
  confidence: 80,
  taken_at: daysAgo(10),
  ...over,
});

function mount() {
  return render(
    <MemoryRouter>
      <LevelJourneyCard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  invoke.mockReset();
});

describe("LevelJourneyCard", () => {
  it("invites a never-placed learner to find their level", async () => {
    invoke.mockResolvedValue({ data: { history: [] }, error: null });
    mount();
    expect(await screen.findByRole("button", { name: "Find my level" })).toBeInTheDocument();
  });

  it("shows the latest level and stays quiet while fresh", async () => {
    invoke.mockResolvedValue({ data: { history: [row()] }, error: null });
    mount();
    // Twice: the headline and the bar's label.
    expect(await screen.findAllByText("B1")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Re-check/ })).not.toBeInTheDocument();
    expect(screen.getByText(/10 days ago/)).toBeInTheDocument();
  });

  it("nudges a re-check once the assessment is stale", async () => {
    invoke.mockResolvedValue({
      data: { history: [row({ taken_at: daysAgo(RECHECK_AFTER_DAYS + 5) })] },
      error: null,
    });
    mount();
    expect(await screen.findByRole("button", { name: "Re-check my level" })).toBeInTheDocument();
  });

  it("celebrates a measured move up", async () => {
    invoke.mockResolvedValue({
      data: {
        history: [
          row({ cefr_level: "A2", taken_at: daysAgo(100) }),
          row({ cefr_level: "B1", taken_at: daysAgo(1) }),
        ],
      },
      error: null,
    });
    mount();
    expect(await screen.findByText(/Up from A2/)).toBeInTheDocument();
  });

  it("charts only the active dialect", async () => {
    invoke.mockResolvedValue({
      data: {
        history: [
          row({ dialect: "Egyptian", cefr_level: "C1" }),
          row({ cefr_level: "A2" }),
        ],
      },
      error: null,
    });
    mount();
    // The headline level is the Gulf one; the Egyptian C1 must not leak in.
    await waitFor(() => expect(screen.getAllByText("A2").length).toBeGreaterThan(0));
    expect(screen.queryByText("C1")).not.toBeInTheDocument();
  });

  it("renders nothing until the history has answered", async () => {
    invoke.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
  });
});
