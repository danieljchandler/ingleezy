import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aReviewStreak } from "@/test/support/factories";
import { localDateKey } from "@/lib/localDate";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { StreakCard } from "./StreakCard";

/**
 * The streak on Today: one number, and the last seven days it is made of.
 *
 * It is the only measure of the run on the page, so the count and the cells
 * have to agree, and a learner with no run has to be invited to start one
 * rather than shown a confident zero.
 */

let cleanup: (() => void) | undefined;

afterEach(async () => {
  // The providers resolve a session in the background; let it land before the
  // stubbed fetch is restored, or it escapes as a real network request.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

function render(rows: Record<string, unknown>[]) {
  const seed = (backend: SupabaseBackend) => backend.db.seed("review_streaks", rows);
  const harness = renderWithProviders(<StreakCard />, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("the streak card", () => {
  it("counts the run and ticks the days it covers", async () => {
    render([aReviewStreak({ current_streak: 3, last_review_date: localDateKey() })]);

    await waitFor(() => expect(screen.getByText("سلسلة 3 أيام")).toBeInTheDocument());
    expect(screen.getAllByLabelText("تم")).toHaveLength(3);
  });

  it("invites a learner with no run to start one", async () => {
    render([]);

    expect(await screen.findByText("ابدأ سلسلتك اليوم")).toBeInTheDocument();
    expect(screen.queryAllByLabelText("تم")).toHaveLength(0);
    // Today is still drawn, as the one cell waiting to be filled.
    expect(screen.getByLabelText("اليوم")).toBeInTheDocument();
  });

  it("always draws seven days", () => {
    render([]);

    expect(screen.getByRole("list", { name: "آخر سبعة أيام" }).children).toHaveLength(7);
  });
});
