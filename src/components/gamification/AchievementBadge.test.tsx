import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Achievement } from "@/hooks/useGamification";
import { AchievementBadge } from "./AchievementBadge";

/**
 * One achievement, earned or not.
 *
 * The grid shows every achievement in the app, including the ones a learner has
 * not reached — that is the point, since an invisible goal motivates nobody. So
 * the same badge has to read clearly in both states, and the unearned one is
 * dimmed and desaturated rather than hidden or replaced by a silhouette.
 */

const anAchievement = (over: Partial<Achievement> = {}): Achievement => ({
  id: "a1",
  name: "First steps",
  name_arabic: "الخطوات الأولى",
  description: "Complete your first review session.",
  icon: "🌱",
  xp_reward: 50,
  requirement_type: "reviews",
  requirement_value: 1,
  ...over,
});

describe("AchievementBadge — what it always shows", () => {
  it("shows the icon", () => {
    render(<AchievementBadge achievement={anAchievement({ icon: "🔥" })} />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });

  it("names the achievement", () => {
    render(<AchievementBadge achievement={anAchievement()} />);
    expect(screen.getByText("First steps")).toBeInTheDocument();
  });

  it("says what earns it", () => {
    // Shown for unearned badges too — a goal nobody can read is not a goal.
    render(<AchievementBadge achievement={anAchievement()} />);
    expect(screen.getByText("Complete your first review session.")).toBeInTheDocument();
  });
});

describe("AchievementBadge — earned and unearned", () => {
  it("dims an achievement not yet reached", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} />);
    expect(container.querySelector(".grayscale")).toBeInTheDocument();
    expect(container.querySelector(".opacity-40")).toBeInTheDocument();
  });

  it("shows an earned one at full strength", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} earned />);
    expect(container.querySelector(".grayscale")).toBeNull();
  });

  it("gives an earned one a gold rim", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} earned />);
    expect(container.querySelector(".border-amber-400")).toBeInTheDocument();
  });

  it("leaves an unearned one a plain rim", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} />);
    expect(container.querySelector(".border-amber-400")).toBeNull();
    expect(container.querySelector(".border-muted")).toBeInTheDocument();
  });

  it("shows the XP once it has been earned", () => {
    render(
      <AchievementBadge achievement={anAchievement()} earned earnedAt="2026-03-01T10:00:00Z" />,
    );
    expect(screen.getByText("+50 XP")).toBeInTheDocument();
  });

  it("does not promise XP for one not yet earned", () => {
    render(<AchievementBadge achievement={anAchievement()} />);
    expect(screen.queryByText("+50 XP")).not.toBeInTheDocument();
  });
});

describe("AchievementBadge — sizes", () => {
  it.each([
    ["sm", "w-12 h-12"],
    ["md", "w-16 h-16"],
    ["lg", "w-20 h-20"],
  ] as const)("sizes the medallion for %s", (size, expected) => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} size={size} />);
    expect(container.querySelector(`.${expected.split(" ").join(".")}`)).toBeInTheDocument();
  });

  it("defaults to the medium size", () => {
    const { container } = render(<AchievementBadge achievement={anAchievement()} />);
    expect(container.querySelector(".w-16")).toBeInTheDocument();
  });

  it("drops the description at the smallest size", () => {
    // The small badge is used in dense rows where the name alone has to carry.
    render(<AchievementBadge achievement={anAchievement()} size="sm" />);
    expect(screen.getByText("First steps")).toBeInTheDocument();
    expect(screen.queryByText("Complete your first review session.")).not.toBeInTheDocument();
  });

  it("drops every label when asked for the icon alone", () => {
    render(<AchievementBadge achievement={anAchievement()} showDetails={false} />);
    expect(screen.getByText("🌱")).toBeInTheDocument();
    expect(screen.queryByText("First steps")).not.toBeInTheDocument();
  });
});

describe("AchievementBadge — when it was earned", () => {
  it("shows the date it was earned", () => {
    // The prop was typed and named as a timestamp and used only as a boolean,
    // so "when did I earn this?" was unanswerable from the grid.
    render(
      <AchievementBadge achievement={anAchievement()} earned earnedAt="2026-03-01T10:00:00Z" />,
    );
    expect(
      screen.getByText(new Date("2026-03-01T10:00:00Z").toLocaleDateString()),
    ).toBeInTheDocument();
  });

  it("shows no date for one that has not been earned", () => {
    render(<AchievementBadge achievement={anAchievement()} earnedAt="2026-03-01T10:00:00Z" />);
    expect(
      screen.queryByText(new Date("2026-03-01T10:00:00Z").toLocaleDateString()),
    ).not.toBeInTheDocument();
  });

  it("shows the XP of an achievement earned without a timestamp", () => {
    // user_achievements.earned_at is nullable, and a row from a backfill or a
    // manual grant has none — which used to show gold and full colour while
    // silently dropping the XP line, making an earned achievement look worth
    // nothing.
    const { container } = render(<AchievementBadge achievement={anAchievement()} earned />);
    expect(container.querySelector(".border-amber-400")).toBeInTheDocument();
    expect(screen.getByText("+50 XP")).toBeInTheDocument();
  });

  it("still withholds the XP from one that has not been earned", () => {
    render(<AchievementBadge achievement={anAchievement()} />);
    expect(screen.queryByText("+50 XP")).not.toBeInTheDocument();
  });
});
