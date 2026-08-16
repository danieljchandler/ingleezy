import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import {
  aProfile,
  aReviewStreak,
  aWeeklyGoal,
  TEST_USER_ID,
} from "@/test/support/factories";
import { localDateKey } from "@/lib/localDate";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { MajlisWelcome } from "./MajlisWelcome";

/**
 * The hero at the top of Today.
 *
 * Everything on it is there to answer "am I keeping this up?" before the
 * learner has to click anything: the greeting in the dialect's register, the
 * streak, and how far into the week's XP they are. It is the first thing on the
 * page and the only place the week's progress is shown at all, so a zero here
 * has to be a real zero rather than a query that has not landed.
 */

/** A Wednesday, mid-morning. The week's Monday is the 12th of August 2026. */
const WEDNESDAY_MORNING = new Date(2026, 7, 12, 9, 30);

/** The Monday `useWeeklyGoal` derives from the pinned clock, via the app's own helper. */
const weekStart = () => {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() + (today.getDay() === 0 ? -6 : 1 - today.getDay()));
  return localDateKey(monday);
};

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(WEDNESDAY_MORNING);
});

afterEach(async () => {
  // useAuth resolves the session on a macrotask and the three queries land
  // after it, at slightly different times. A test that asserted before all of
  // them settled would leave the rest resolving into a tree being unmounted,
  // which React reports as an update outside act(). Flushing here keeps that
  // out of every individual test.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

interface Options {
  persona?: "free" | "anonymous";
  streak?: number | null;
  earned?: number;
  target?: number;
  displayName?: string | null;
  seed?: (backend: SupabaseBackend) => void;
}

function render({
  persona = "free",
  streak = 5,
  earned = 120,
  target = 300,
  displayName = "Layla Hassan",
  seed,
}: Options = {}) {
  const harness = renderWithProviders(<MajlisWelcome />, {
    persona,
    seed: (backend) => {
      if (persona !== "anonymous") {
        backend.db.seed("profiles", [aProfile({ display_name: displayName })]);
        backend.db.seed(
          "review_streaks",
          streak === null ? [] : [aReviewStreak({ user_id: TEST_USER_ID, current_streak: streak })],
        );
        backend.db.seed("weekly_goals", [
          aWeeklyGoal({
            user_id: TEST_USER_ID,
            week_start_date: weekStart(),
            earned_xp: earned,
            target_xp: target,
          }),
        ]);
      }
      seed?.(backend);
    },
  });
  cleanup = harness.cleanup;
  return harness;
}

/**
 * Waits for both per-user queries to land. Without it a synchronous assertion
 * finishes while they are still in flight and React logs an update outside
 * act() when they resolve into an unmounting tree.
 */
const settle = () =>
  waitFor(() => expect(screen.getByTitle(/XP this week/)).toBeInTheDocument());

/**
 * A signed-out render has nothing to wait for on screen, but `useAuth` still
 * resolves the (absent) session on a macrotask and sets state when it does.
 */
const settleAuth = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** The progress arc — the second circle, the one with a dash pattern. */
const ring = () => document.querySelectorAll("circle")[1] as SVGCircleElement;

const CIRCUMFERENCE = 2 * Math.PI * 26;

describe("greeting the learner", () => {
  it.each([
    [3, "تصبح على خير", "Late night"],
    [9, "صَبَاحُ الخَيْر", "Good morning"],
    [14, "نَهَارَك سَعِيد", "Good afternoon"],
    [19, "مَسَاءُ الخَيْر", "Good evening"],
    [23, "تصبح على خير", "Good night"],
  ])("greets %i:00 with %s", async (hour, arabic, english) => {
    vi.setSystemTime(new Date(2026, 7, 12, hour, 0));
    render();

    // Register is the point: a learner who only ever sees "hello" never picks
    // up that Arabic greets the time of day.
    expect(screen.getByText(arabic)).toHaveAttribute("dir", "rtl");
    expect(screen.getByText(new RegExp(english))).toBeInTheDocument();
    await settle();
  });

  it("distinguishes the late night from the good night in English only", async () => {
    vi.setSystemTime(new Date(2026, 7, 12, 3, 0));
    render();

    // Pinned: both bands render the same Arabic — تصبح على خير, which is what
    // you say when *leaving*. At 3am the learner is arriving, and the English
    // line is the only thing that differs.
    expect(screen.getByText("تصبح على خير")).toBeInTheDocument();
    expect(screen.getByText(/Late night/)).toBeInTheDocument();
    await settle();
  });

  it("uses the learner's first name", async () => {
    render();

    await waitFor(() => expect(screen.getByText(/Good morning, Layla/)).toBeInTheDocument());
  });

  it("falls back to the part of the address before the @", async () => {
    render({ displayName: null });

    // Better than nothing, and the alternative — an empty greeting — reads as
    // a rendering bug rather than a missing profile field.
    await waitFor(() => expect(screen.getByText(/Good morning, e2e/)).toBeInTheDocument());
  });

  it("greets a signed-out visitor without a name", async () => {
    render({ persona: "anonymous" });

    expect(screen.getByText("Good morning")).toBeInTheDocument();
    await settleAuth();
  });
});

describe("the dialect chip", () => {
  it("names the dialect being learned", async () => {
    render();

    // Two dialects' content look alike at a glance, so which module is active
    // has to be visible without opening settings.
    expect(screen.getByText("Gulf")).toBeInTheDocument();
    expect(screen.getByText("🌊")).toBeInTheDocument();
    await settle();
  });

  it("follows the stored dialect", async () => {
    localStorage.setItem("ingleezy_dialect_module", "Egyptian");
    render();

    expect(screen.getByText("Egyptian")).toBeInTheDocument();
    expect(screen.getByText("🇪🇬")).toBeInTheDocument();
    await settle();
  });
});

describe("the streak", () => {
  it("shows the run of days and lights it up", async () => {
    render({ streak: 5 });

    const flame = await screen.findByTitle("5-day streak");
    expect(flame.textContent).toContain("5d");
    // Warm when it is alive: the flame is the reward, and a grey one on day
    // five would read as broken. Amber is the palette's one warm note, and
    // the streak is exactly what the brand guide reserves it for.
    expect(flame.className).toContain("border-[#D98A3D]/40");
  });

  it("shows a cold zero rather than hiding when the streak is broken", async () => {
    render({ streak: 0 });

    const flame = await screen.findByTitle("0-day streak");
    expect(flame.className).toContain("bg-[#2C3B74]/5");
    expect(flame.querySelector(".lucide-flame")!.getAttribute("class")).toContain(
      "text-[#2C3B74]/40",
    );
  });

  it("reads a learner who has never reviewed as zero", async () => {
    render({ streak: null });

    // No row at all is the state on day one. It has to look the same as a
    // broken streak, not blank.
    await waitFor(() => expect(screen.getByTitle("0-day streak")).toBeInTheDocument());
  });

  it("is not shown to a signed-out visitor", async () => {
    render({ persona: "anonymous" });
    await settleAuth();

    // There is nothing to have a streak of yet, and a zero would be a discouraging
    // first impression on a page they have not signed up for.
    expect(screen.queryByText(/day streak/)).toBeNull();
  });
});

describe("the weekly XP ring", () => {
  it("fills in proportion to the week's target", async () => {
    render({ earned: 120, target: 300 });

    await waitFor(() => expect(screen.getByTitle("120 / 300 XP this week")).toBeInTheDocument());
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("XP")).toBeInTheDocument();
    // 40% of the circumference, the rest left as gap.
    const [dash] = ring().getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBeCloseTo(0.4 * CIRCUMFERENCE, 5);
  });

  it("leaves the ring empty at the start of the week", async () => {
    render({ earned: 0, target: 300 });

    await waitFor(() => expect(screen.getByTitle("0 / 300 XP this week")).toBeInTheDocument());
    const [dash] = ring().getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBe(0);
  });

  it("does not overfill once the target is beaten", async () => {
    render({ earned: 900, target: 300 });

    await waitFor(() => expect(screen.getByTitle("900 / 300 XP this week")).toBeInTheDocument());
    // A dash longer than the circumference draws a second lap over the first,
    // which looks like a rendering fault rather than an achievement.
    const [dash] = ring().getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBeCloseTo(CIRCUMFERENCE, 5);
    expect(screen.getByText("900")).toBeInTheDocument();
  });

  it("survives a target of zero", async () => {
    render({ earned: 50, target: 0 });

    // The hook returns target_xp: 0 for a learner with no goal row for this
    // week, so this is the ordinary first-visit state — not an edge case. A
    // straight division would put NaN in the dash array and blank the ring.
    await waitFor(() => expect(screen.getByText("50")).toBeInTheDocument());
    const [dash] = ring().getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(Number.isNaN(dash)).toBe(false);
    expect(dash).toBeCloseTo(CIRCUMFERENCE, 5);
  });

  it("shows a hundred-XP target when the week has no goal row yet", async () => {
    render({ seed: (backend) => backend.db.seed("weekly_goals", []) });

    // Distinct from target_xp: 0 — here the whole query resolves to null, and
    // the component's own default applies.
    await waitFor(() => expect(screen.getByTitle("0 / 100 XP this week")).toBeInTheDocument());
  });

  it("is not shown to a signed-out visitor", async () => {
    render({ persona: "anonymous" });
    await settleAuth();

    expect(screen.queryByText("XP")).toBeNull();
    expect(document.querySelectorAll("circle")).toHaveLength(0);
  });
});

describe("the panel itself", () => {
  it("dresses the card without putting the decoration in the way", async () => {
    render();

    // The watermark and the glow are both full-bleed layers over the text; if
    // either caught pointer events the greeting would be unselectable and the
    // chips unclickable.
    for (const layer of document.querySelectorAll("[aria-hidden]")) {
      expect(layer.className).toContain("pointer-events-none");
    }
    await settle();
  });
});
