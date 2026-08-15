import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MilestoneBanner } from "./MilestoneBanner";

/**
 * The banner that congratulates a learner for crossing a quarter of the
 * English Sounds journey.
 *
 * Twenty-eight sounds is a long climb with no natural finish line before the
 * end, so the trainer plants four: 7, 14, 21, 28. Each is meant to be seen
 * once and then never again, which is the only interesting thing about the
 * component — the celebration is trivial, and remembering that it has already
 * happened is not.
 */

const STORAGE_KEY = "ingleezy:sounds:milestone-seen";

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/uiPrefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uiPrefs")>()),
  useReducedMotion: () => reduced.value,
}));

beforeEach(() => {
  localStorage.clear();
  reduced.value = false;
});

afterEach(() => {
  localStorage.clear();
});

const seen = (...thresholds: number[]) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));

const banner = () => screen.queryByRole("status");
const dismiss = () => fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));

/** Arabic count phrase this component renders for a given threshold. */
const countText = (n: number) => {
  if (n >= 3 && n <= 10) return `${n} أصوات`;
  return `${n} صوتاً`;
};

describe("MilestoneBanner — when it appears", () => {
  it("stays away below the first milestone", () => {
    render(<MilestoneBanner masteredCount={6} />);
    expect(banner()).not.toBeInTheDocument();
  });

  it("appears on the seventh sound", () => {
    render(<MilestoneBanner masteredCount={7} />);
    expect(screen.getByText(`أتقنت ${countText(7)}!`)).toBeInTheDocument();
  });

  it.each([7, 14, 21, 28])("celebrates %i sounds", (count) => {
    render(<MilestoneBanner masteredCount={count} />);
    expect(screen.getByText(`أتقنت ${countText(count)}!`)).toBeInTheDocument();
  });

  it("celebrates the milestone passed, not the exact count", () => {
    render(<MilestoneBanner masteredCount={17} />);
    expect(screen.getByText(`أتقنت ${countText(14)}!`)).toBeInTheDocument();
  });

  it("shows the highest one reached rather than the first", () => {
    // A learner who comes back after a long break, or whose progress loads all
    // at once, should see the achievement they actually have.
    render(<MilestoneBanner masteredCount={28} />);
    expect(screen.getByText(`أتقنت ${countText(28)}!`)).toBeInTheDocument();
  });

  it("appears when a later sound pushes the count over the line", () => {
    const { rerender } = render(<MilestoneBanner masteredCount={13} />);
    expect(screen.queryByText(`أتقنت ${countText(14)}!`)).not.toBeInTheDocument();

    rerender(<MilestoneBanner masteredCount={14} />);
    expect(screen.getByText(`أتقنت ${countText(14)}!`)).toBeInTheDocument();
  });

  it("announces itself politely rather than interrupting", () => {
    render(<MilestoneBanner masteredCount={7} />);
    expect(banner()).toBeInTheDocument();
  });
});

describe("MilestoneBanner — what it says", () => {
  it("keeps the learner going at the intermediate milestones", () => {
    render(<MilestoneBanner masteredCount={21} />);
    expect(screen.getByText("استمر — القافلة تواصل مسيرها.")).toBeInTheDocument();
  });

  it("marks the whole journey differently", () => {
    render(<MilestoneBanner masteredCount={28} />);
    expect(screen.getByText("أنهيت رحلة القافلة كاملة 🐪")).toBeInTheDocument();
  });

  it("animates the shine by default", () => {
    const { container } = render(<MilestoneBanner masteredCount={7} />);
    expect(container.querySelector(".animate-banner-shine")).toBeInTheDocument();
  });

  it("drops the shine for a learner who asked for less motion", () => {
    reduced.value = true;
    const { container } = render(<MilestoneBanner masteredCount={7} />);
    expect(container.querySelector(".animate-banner-shine")).not.toBeInTheDocument();
    expect(screen.getByText(`أتقنت ${countText(7)}!`)).toBeInTheDocument();
  });
});

describe("MilestoneBanner — remembering it has been seen", () => {
  it("goes away when dismissed", () => {
    render(<MilestoneBanner masteredCount={7} />);
    dismiss();
    expect(banner()).not.toBeInTheDocument();
  });

  it("records the milestone as seen", () => {
    render(<MilestoneBanner masteredCount={7} />);
    dismiss();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([7]);
  });

  it("stays away on the next visit", () => {
    const first = render(<MilestoneBanner masteredCount={7} />);
    dismiss();
    first.unmount();

    render(<MilestoneBanner masteredCount={7} />);
    expect(banner()).not.toBeInTheDocument();
  });

  it("appears again at the next milestone", () => {
    seen(7);
    render(<MilestoneBanner masteredCount={14} />);
    expect(screen.getByText(`أتقنت ${countText(14)}!`)).toBeInTheDocument();
  });

  it("adds to the record rather than replacing it", () => {
    seen(7);
    render(<MilestoneBanner masteredCount={14} />);
    dismiss();
    expect(new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)!))).toEqual(new Set([7, 14]));
  });

  it("treats unreadable storage as nothing seen", () => {
    // Better to celebrate twice than to swallow a milestone because a browser
    // extension left junk in the key.
    localStorage.setItem(STORAGE_KEY, "not json");
    render(<MilestoneBanner masteredCount={7} />);
    expect(screen.getByText(`أتقنت ${countText(7)}!`)).toBeInTheDocument();
  });

  it("survives storage it cannot write to", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    render(<MilestoneBanner masteredCount={7} />);
    dismiss();
    expect(banner()).not.toBeInTheDocument();
    setItem.mockRestore();
  });

  it("does not count downwards after the top milestone is dismissed", () => {
    // A learner whose progress arrives in one go — a second device, or an
    // account restored from the server — used to be congratulated on 28, then
    // 21, then 14, then 7: four celebrations of milestones long past, each a
    // smaller number than the last.
    const first = render(<MilestoneBanner masteredCount={28} />);
    expect(screen.getByText(`أتقنت ${countText(28)}!`)).toBeInTheDocument();
    dismiss();
    first.unmount();

    render(<MilestoneBanner masteredCount={28} />);
    expect(banner()).not.toBeInTheDocument();
  });

  it("records every threshold the dismissed one implies", () => {
    render(<MilestoneBanner masteredCount={28} />);
    dismiss();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sort((a: number, b: number) => a - b))
      .toEqual([7, 14, 21, 28]);
  });

  it("leaves the milestones above the dismissed one still to come", () => {
    // Only what the learner has actually passed is marked, so a banner they
    // have not earned yet is still waiting for them.
    const first = render(<MilestoneBanner masteredCount={14} />);
    dismiss();
    first.unmount();

    render(<MilestoneBanner masteredCount={21} />);
    expect(screen.getByText(`أتقنت ${countText(21)}!`)).toBeInTheDocument();
  });

  it("stays dismissed when one more sound is mastered", () => {
    // The effect reruns on `masteredCount`, so before the fix the next lower
    // threshold arrived without even a reload.
    const { rerender } = render(<MilestoneBanner masteredCount={28} />);
    dismiss();
    expect(banner()).not.toBeInTheDocument();

    rerender(<MilestoneBanner masteredCount={28} />);
    expect(banner()).not.toBeInTheDocument();

    rerender(<MilestoneBanner masteredCount={27} />);
    expect(banner()).not.toBeInTheDocument();
  });
});
