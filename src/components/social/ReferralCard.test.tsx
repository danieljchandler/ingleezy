import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralCard } from "./ReferralCard";

/**
 * The referral card. Two behaviours carry the design: it is lazy (nothing is
 * fetched until the learner opens it, so every page hosting it stays cheap
 * and its e2e specs stay quiet), and its copy adapts to whether rewards are
 * actually configured server-side — promising a free month the backend can't
 * grant would be the worst kind of growth copy.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

const info = (over: Record<string, unknown> = {}) => ({
  code: "GVQX7RPM",
  referrals: { pending: 1, converted: 1, rewarded: 0 },
  redeemed: false,
  rewards_enabled: true,
  ...over,
});

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ data: info(), error: null });
});

async function open() {
  render(<ReferralCard />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Invite friends/ }));
  });
}

describe("laziness", () => {
  it("fetches nothing until opened", () => {
    render(<ReferralCard />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fetches the code once on open", async () => {
    await open();
    expect(invoke).toHaveBeenCalledWith("referral", { body: { action: "get" } });
    expect(await screen.findByText("GVQX7RPM")).toBeInTheDocument();
  });
});

describe("the offer copy", () => {
  it("promises the month only when the backend can grant it", async () => {
    await open();
    expect(screen.getByText("Give a month, get a month")).toBeInTheDocument();
  });

  it("falls back to a plain invite when rewards are not configured", async () => {
    invoke.mockResolvedValue({ data: info({ rewards_enabled: false }), error: null });
    await open();
    expect(screen.getByText("Invite friends")).toBeInTheDocument();
    expect(screen.queryByText(/first month free/)).not.toBeInTheDocument();
  });

  it("shows the tallies a referrer actually cares about", async () => {
    await open();
    expect(screen.getByText(/2 joined · 1 subscribed/)).toBeInTheDocument();
  });
});

describe("redeeming", () => {
  it("sends the entered code and confirms", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Referral code"), { target: { value: "ABCD2345" } });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
    });

    expect(invoke).toHaveBeenLastCalledWith("referral", {
      body: { action: "redeem", code: "ABCD2345" },
    });
    // The input row retires once this account has redeemed.
    await waitFor(() =>
      expect(screen.queryByLabelText("Referral code")).not.toBeInTheDocument(),
    );
  });

  it("hides the redeem row for an account that already used a code", async () => {
    invoke.mockResolvedValue({ data: info({ redeemed: true }), error: null });
    await open();
    expect(screen.queryByLabelText("Referral code")).not.toBeInTheDocument();
  });

  it("surfaces the server's reason when a redeem is refused", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Referral code"), { target: { value: "OLDACCT2" } });
    invoke.mockResolvedValueOnce({
      data: { error: "new_accounts_only", message: "Referral codes can only be used within your first month." },
      error: null,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
    });

    // The input stays — the learner may have another (valid) code.
    expect(screen.getByLabelText("Referral code")).toBeInTheDocument();
  });
});

describe("failure", () => {
  it("collapses back to the button when the code cannot load", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    await open();
    expect(screen.getByRole("button", { name: /Invite friends/ })).toBeInTheDocument();
    expect(screen.queryByText("GVQX7RPM")).not.toBeInTheDocument();
  });
});
