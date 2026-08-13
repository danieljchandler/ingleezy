import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearContinue,
  formatRelativeTime,
  getContinue,
  recordContinue,
  type ContinueEntry,
} from "./continueProgress";

/**
 * The "continue where you left off" card on Home.
 *
 * Written from a video timer, so it throttles; read by a card that must not
 * offer a week-old story as though the learner just left it. Both the throttle
 * and the expiry are time-dependent, which is why the clock is frozen here.
 */

const NOON = new Date("2026-03-11T12:00:00");

/**
 * Each test starts a minute later than the last.
 *
 * The throttle keeps its last-written key and timestamp in module scope, and
 * the module is loaded once for the file. Freezing every test at the same
 * instant would leave a later test looking like a sub-five-second repeat of an
 * earlier one's write, and it would be throttled away — which is exactly what
 * happened before this.
 */
let now = NOON.getTime();

const anEntry = (over: Partial<Omit<ContinueEntry, "updatedAt">> = {}) => ({
  kind: "story" as const,
  route: "/stories/abc",
  title: "A story",
  subtitle: "Scene 3 of 8",
  dialect: "Gulf",
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  now += 60_000;
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("recording", () => {
  it("stores what the card needs to render and navigate", () => {
    recordContinue(anEntry());

    expect(getContinue()).toMatchObject({
      kind: "story",
      route: "/stories/abc",
      title: "A story",
      subtitle: "Scene 3 of 8",
      dialect: "Gulf",
      updatedAt: now,
    });
  });

  it("keeps only the most recent activity", () => {
    // One card, not a history — the newest write wins.
    recordContinue(anEntry({ route: "/stories/abc", title: "First" }));
    vi.advanceTimersByTime(10_000);
    recordContinue(anEntry({ route: "/videos/xyz", title: "Second", kind: "video" }));

    expect(getContinue()).toMatchObject({ title: "Second", kind: "video" });
  });

  it("announces the change, since the storage event does not fire in the same tab", () => {
    const listener = vi.fn();
    window.addEventListener("ingleezy:continue-changed", listener);

    recordContinue(anEntry());

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("ingleezy:continue-changed", listener);
  });

  it("survives a blocked write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => recordContinue(anEntry())).not.toThrow();
  });
});

describe("throttling", () => {
  it("ignores a repeat of the same position within five seconds", () => {
    // The video player writes on a timer; without this it would hammer
    // localStorage several times a second for the whole of a clip.
    recordContinue(anEntry({ title: "First" }));
    vi.advanceTimersByTime(1000);
    recordContinue(anEntry({ title: "Should be ignored" }));

    expect(getContinue()).toMatchObject({ title: "First" });
  });

  it("accepts the same position again once the interval has passed", () => {
    recordContinue(anEntry({ title: "First" }));
    vi.advanceTimersByTime(5001);
    recordContinue(anEntry({ title: "Second" }));

    expect(getContinue()).toMatchObject({ title: "Second" });
  });

  it("never throttles a move to a different position", () => {
    // Progress within a story changes the subtitle, and that has to get through
    // immediately or the card shows a stale scene.
    recordContinue(anEntry({ subtitle: "Scene 3 of 8" }));
    vi.advanceTimersByTime(100);
    recordContinue(anEntry({ subtitle: "Scene 4 of 8" }));

    expect(getContinue()).toMatchObject({ subtitle: "Scene 4 of 8" });
  });

  it("never throttles a move to different content", () => {
    recordContinue(anEntry({ route: "/stories/abc" }));
    vi.advanceTimersByTime(100);
    recordContinue(anEntry({ route: "/stories/def", title: "Another" }));

    expect(getContinue()).toMatchObject({ title: "Another" });
  });

  it("never throttles a switch of dialect", () => {
    // The card is scoped to the active module, so the same story in another
    // dialect is a different entry.
    recordContinue(anEntry({ dialect: "Gulf" }));
    vi.advanceTimersByTime(100);
    recordContinue(anEntry({ dialect: "Egyptian", title: "Egyptian version" }));

    expect(getContinue()).toMatchObject({ title: "Egyptian version" });
  });
});

describe("expiry", () => {
  it("still offers something from six days ago", () => {
    recordContinue(anEntry());

    vi.setSystemTime(now + 6 * 24 * 60 * 60 * 1000);

    expect(getContinue()).not.toBeNull();
  });

  it("forgets anything older than a week", () => {
    // Offering a week-old story as "continue where you left off" is worse than
    // offering nothing.
    recordContinue(anEntry());

    vi.setSystemTime(now + 8 * 24 * 60 * 60 * 1000);

    expect(getContinue()).toBeNull();
  });

  it("clears the expired entry rather than re-reading it every time", () => {
    recordContinue(anEntry());
    vi.setSystemTime(now + 8 * 24 * 60 * 60 * 1000);

    getContinue();

    expect(localStorage.getItem("ingleezy:continue:v1")).toBeNull();
  });
});

describe("reading a damaged entry", () => {
  it("returns null for unparseable storage", () => {
    localStorage.setItem("ingleezy:continue:v1", "{not json");
    expect(getContinue()).toBeNull();
  });

  it("returns null when the timestamp is missing", () => {
    // Without updatedAt the expiry check cannot run, so the entry is not
    // trustworthy at any age.
    localStorage.setItem("ingleezy:continue:v1", JSON.stringify({ kind: "story", route: "/x" }));
    expect(getContinue()).toBeNull();
  });

  it("returns null when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(getContinue()).toBeNull();
  });
});

describe("clearing", () => {
  it("removes the entry and announces it", () => {
    recordContinue(anEntry());
    const listener = vi.fn();
    window.addEventListener("ingleezy:continue-changed", listener);

    clearContinue();

    expect(getContinue()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("ingleezy:continue-changed", listener);
  });
});

describe("formatRelativeTime", () => {
  it("says 'just now' under a minute", () => {
    expect(formatRelativeTime(now - 30_000)).toBe("just now");
  });

  it("counts whole minutes up to an hour", () => {
    expect(formatRelativeTime(now - 60_000)).toBe("1m ago");
    expect(formatRelativeTime(now - 59 * 60_000)).toBe("59m ago");
  });

  it("switches to hours at sixty minutes", () => {
    expect(formatRelativeTime(now - 60 * 60_000)).toBe("1h ago");
    expect(formatRelativeTime(now - 23 * 60 * 60_000)).toBe("23h ago");
  });

  it("switches to days at twenty-four hours", () => {
    expect(formatRelativeTime(now - 24 * 60 * 60_000)).toBe("1d ago");
    expect(formatRelativeTime(now - 6 * 24 * 60 * 60_000)).toBe("6d ago");
  });

  it("rounds down rather than up, so nothing reads as older than it is", () => {
    expect(formatRelativeTime(now - 119_000)).toBe("1m ago");
  });
});
