import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoverPreviewCard, type DiscoverVideo } from "./DiscoverPreviewCard";

/**
 * A video in the Discover feed.
 *
 * The whole card is one button, because the feed is scrolled with a thumb and
 * anything smaller than the card is a miss. Everything the learner needs to
 * decide with sits on the thumbnail: the dialect, how hard it is, and how long
 * it takes. The difficulty badge is the one with a rule behind it — a CEFR
 * level is a real measurement and supersedes the hand-set difficulty label
 * whenever the pipeline has produced one.
 */

const aVideo = (over: Partial<DiscoverVideo> = {}): DiscoverVideo => ({
  id: "v1",
  title: "Ordering coffee in Doha",
  thumbnail_url: "https://cdn.test/thumb.jpg",
  dialect: "Gulf",
  duration_seconds: 185,
  ...over,
});

function renderCard(video: DiscoverVideo = aVideo()) {
  const onClick = vi.fn();
  const result = render(<DiscoverPreviewCard video={video} onClick={onClick} />);
  return { ...result, onClick };
}

const badges = (container: HTMLElement) =>
  [...container.querySelectorAll(".rounded-full, [class*='badge']")].map((el) => el.textContent);

describe("DiscoverPreviewCard — the whole card is the target", () => {
  it("is a single button", () => {
    renderCard();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("opens the video when tapped", () => {
    const { onClick } = renderCard();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("says what it will do, not just what it shows", () => {
    renderCard(aVideo({ title: "Haggling at the souq" }));
    expect(
      screen.getByRole("button", { name: /^Watch video: Haggling at the souq/ }),
    ).toBeInTheDocument();
  });

  it("offers a visible call to action as well", () => {
    renderCard();
    expect(screen.getByText("ابدأ المشاهدة")).toBeInTheDocument();
  });

  it("carries the dialect, level and length in the accessible name", () => {
    // A button's label replaces its contents for assistive technology, so the
    // title alone was the entire card as far as a screen reader was concerned —
    // and the things a sighted learner scans to choose between videos all sit
    // inside the button, and were inaudible.
    renderCard(
      aVideo({ dialect: "Egyptian", cefr_level: "B1", duration_seconds: 185 }),
    );
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "Watch video: Ordering coffee in Doha, Egyptian, B1, 3:05",
    );
  });

  it("leaves out the details a video does not have", () => {
    renderCard(
      aVideo({ dialect: null, cefr_level: null, duration_seconds: null }),
    );
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "Watch video: Ordering coffee in Doha",
    );
  });

  it("keeps the same order as the badges on screen", () => {
    // Spoken and seen should agree, or the two descriptions of one card have to
    // be reconciled by the listener.
    renderCard(aVideo({ dialect: "Gulf", cefr_level: "A2", duration_seconds: 60 }));
    const name = screen.getByRole("button").getAttribute("aria-label")!;
    expect(name.indexOf("Gulf")).toBeLessThan(name.indexOf("A2"));
    expect(name.indexOf("A2")).toBeLessThan(name.indexOf("1:00"));
  });
});

describe("DiscoverPreviewCard — the thumbnail", () => {
  it("shows the video's still", () => {
    renderCard();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.test/thumb.jpg");
  });

  it("describes the still by the video's title", () => {
    renderCard();
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Ordering coffee in Doha");
  });

  it("falls back to a placeholder when there is no still", () => {
    // A missing thumbnail is common for a freshly ingested video, and a blank
    // 4:3 hole would look like a broken card rather than a pending one.
    const { container } = renderCard(aVideo({ thumbnail_url: null }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector(".bg-muted")).toBeInTheDocument();
  });

  it("keeps the play indicator either way", () => {
    const { container } = renderCard(aVideo({ thumbnail_url: null }));
    expect(container.querySelector(".bg-primary\\/90")).toBeInTheDocument();
  });

  it("hides its decorative icons from assistive technology", () => {
    const { container } = renderCard();
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs.length).toBeGreaterThan(0);
    expect(svgs.every((svg) => svg.getAttribute("aria-hidden") === "true")).toBe(true);
  });
});

describe("DiscoverPreviewCard — the titles", () => {
  it("shows the English title", () => {
    renderCard();
    expect(screen.getByRole("heading")).toHaveTextContent("Ordering coffee in Doha");
  });

  it("shows the Arabic title underneath, right-to-left", () => {
    renderCard(aVideo({ title_arabic: "طلب القهوة في الدوحة" }));
    expect(screen.getByText("طلب القهوة في الدوحة")).toHaveAttribute("dir", "rtl");
  });

  it("leaves the Arabic line out when there is none", () => {
    const { container } = renderCard();
    expect(container.querySelector("[dir='rtl']")).toBeNull();
  });

  it("clamps a long title rather than letting it push the badges off", () => {
    renderCard(aVideo({ title: "A very long title ".repeat(20) }));
    expect(screen.getByRole("heading")).toHaveClass("line-clamp-2");
  });
});

describe("DiscoverPreviewCard — the badges", () => {
  it("shows the dialect", () => {
    renderCard(aVideo({ dialect: "Yemeni" }));
    expect(screen.getByText("Yemeni")).toBeInTheDocument();
  });

  it("leaves the dialect off when it is unknown", () => {
    const { container } = renderCard(aVideo({ dialect: null }));
    expect(badges(container)).not.toContain("Gulf");
  });

  it("prefers a measured CEFR level to a hand-set difficulty", () => {
    // The level comes out of the analysis pipeline; `difficulty` is whatever an
    // admin typed when the video was added. Showing both would be two answers
    // to one question.
    renderCard(aVideo({ cefr_level: "B1", difficulty: "intermediate" }));
    expect(screen.getByText("B1")).toBeInTheDocument();
    expect(screen.queryByText("intermediate")).not.toBeInTheDocument();
  });

  it("falls back to the difficulty label when there is no level", () => {
    renderCard(aVideo({ cefr_level: null, difficulty: "beginner" }));
    expect(screen.getByText("beginner")).toBeInTheDocument();
  });

  it("shows neither when the video has not been graded", () => {
    const { container } = renderCard(aVideo({ cefr_level: null, difficulty: null }));
    expect(badges(container).filter(Boolean)).toEqual(["Gulf", "3:05"]);
  });

  it("shows the speaking pace when it has been measured", () => {
    // Pace is what separates a video a learner can follow from one they cannot,
    // more reliably than the level does.
    renderCard(aVideo({ difficulty_metrics: { words_per_minute: 132.6 } }));
    expect(screen.getByText("133 wpm")).toBeInTheDocument();
  });

  it("leaves the pace off when it was never measured", () => {
    renderCard(aVideo({ difficulty_metrics: { words_per_minute: null } }));
    expect(screen.queryByText(/wpm$/)).not.toBeInTheDocument();
  });

  it("leaves the pace off when there are no metrics at all", () => {
    renderCard(aVideo({ difficulty_metrics: null }));
    expect(screen.queryByText(/wpm$/)).not.toBeInTheDocument();
  });

  it("shows the running time", () => {
    renderCard(aVideo({ duration_seconds: 185 }));
    expect(screen.getByText("3:05")).toBeInTheDocument();
  });

  it("pads the seconds", () => {
    renderCard(aVideo({ duration_seconds: 65 }));
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("leaves the running time off when it is unknown", () => {
    const { container } = renderCard(aVideo({ duration_seconds: null }));
    expect(badges(container)).not.toContain("0:00");
  });

  it("treats a zero-length video as unknown rather than showing 0:00", () => {
    // Zero means the probe failed, not that the video is empty.
    const { container } = renderCard(aVideo({ duration_seconds: 0 }));
    expect(badges(container)).not.toContain("0:00");
  });
});
