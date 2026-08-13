import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  all,
  bumpAttempts,
  clearForUser,
  count,
  enqueue,
  peek,
  remove,
  type QueuedReviewSnapshot,
} from "./reviewQueue";

/**
 * The offline rating queue.
 *
 * Every review a learner gives passes through here before it reaches the
 * server, so a bug in it loses work silently: the UI advances immediately and
 * nothing tells the learner their rating never arrived. It is also the only
 * part of the review path that has to survive a reload, a crash, and a
 * connection that comes back later.
 */

const USER = "user-1";
const OTHER_USER = "user-2";

const snapshot = (over: Partial<QueuedReviewSnapshot> = {}): QueuedReviewSnapshot => ({
  id: "review-1",
  ease_factor: 5,
  difficulty: 5,
  interval_days: 3,
  repetitions: 2,
  lapses: 0,
  last_reviewed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  next_review_at: new Date(Date.now() - 86_400_000).toISOString(),
  ...over,
});

const anEntry = (over: Record<string, unknown> = {}) => ({
  wordId: "word-1",
  rating: "good" as const,
  direction: "recognition" as const,
  currentReview: snapshot(),
  ...over,
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("enqueue", () => {
  it("stores the rating and returns it with an id", () => {
    const item = enqueue(USER, anEntry());

    expect(item.id).toEqual(expect.any(String));
    expect(item.userId).toBe(USER);
    expect(item.attempts).toBe(0);
    expect(all(USER)).toHaveLength(1);
  });

  it("keeps ratings in the order they were given", () => {
    // The flush is sequential and each rating is computed from the snapshot
    // taken when it was given, so replaying them out of order would apply the
    // wrong schedule.
    enqueue(USER, anEntry({ wordId: "first" }));
    enqueue(USER, anEntry({ wordId: "second" }));
    enqueue(USER, anEntry({ wordId: "third" }));

    expect(all(USER).map((item) => item.wordId)).toEqual(["first", "second", "third"]);
  });

  it("keeps the direction, since it decides which columns get written", () => {
    const item = enqueue(USER, anEntry({ direction: "production" }));
    expect(item.direction).toBe("production");
    expect(all(USER)[0].direction).toBe("production");
  });

  it("carries the snapshot the rating was computed against", () => {
    // The scheduler needs the card's state at rating time, not at flush time —
    // by then the row may have moved on.
    const at = snapshot({ repetitions: 9, interval_days: 40 });
    enqueue(USER, anEntry({ currentReview: at }));

    expect(all(USER)[0].currentReview).toMatchObject({ repetitions: 9, interval_days: 40 });
  });

  it("accepts a null snapshot, for a card with no review row yet", () => {
    enqueue(USER, anEntry({ currentReview: null }));
    expect(all(USER)[0].currentReview).toBeNull();
  });

  it("survives a browser with no crypto.randomUUID", () => {
    // The fallback exists for older Safari and for non-secure contexts.
    vi.spyOn(globalThis, "crypto", "get").mockReturnValue({} as Crypto);

    const item = enqueue(USER, anEntry());
    expect(item.id).toEqual(expect.any(String));
    expect(item.id.length).toBeGreaterThan(0);
  });

  it("gives each rating a distinct id, even on the fallback path", () => {
    vi.spyOn(globalThis, "crypto", "get").mockReturnValue({} as Crypto);

    // `remove` deletes by id, so a collision would drop somebody else's rating
    // when the first of the pair flushed. The fallback is the risky one — it is
    // a timestamp plus a random suffix, and two ratings given in the same
    // millisecond share the timestamp.
    const ids = Array.from({ length: 50 }, () => enqueue(USER, anEntry()).id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("per-user isolation", () => {
  it("keeps one user's queue out of another's", () => {
    // Two accounts on a shared device must not flush each other's ratings.
    enqueue(USER, anEntry({ wordId: "mine" }));
    enqueue(OTHER_USER, anEntry({ wordId: "theirs" }));

    expect(all(USER).map((item) => item.wordId)).toEqual(["mine"]);
    expect(all(OTHER_USER).map((item) => item.wordId)).toEqual(["theirs"]);
  });

  it("clearing one user leaves the other alone", () => {
    enqueue(USER, anEntry());
    enqueue(OTHER_USER, anEntry());

    clearForUser(USER);

    expect(count(USER)).toBe(0);
    expect(count(OTHER_USER)).toBe(1);
  });
});

describe("peek and remove", () => {
  it("peek returns the oldest rating without removing it", () => {
    enqueue(USER, anEntry({ wordId: "first" }));
    enqueue(USER, anEntry({ wordId: "second" }));

    expect(peek(USER)?.wordId).toBe("first");
    expect(count(USER)).toBe(2);
  });

  it("peek returns null on an empty queue", () => {
    expect(peek(USER)).toBeNull();
  });

  it("remove takes out exactly the one named", () => {
    const first = enqueue(USER, anEntry({ wordId: "first" }));
    enqueue(USER, anEntry({ wordId: "second" }));

    remove(USER, first.id);

    expect(all(USER).map((item) => item.wordId)).toEqual(["second"]);
  });

  it("removing something already gone is harmless", () => {
    // The flush can race with itself; a double remove must not throw or clear
    // the queue.
    enqueue(USER, anEntry());
    remove(USER, "not-a-real-id");

    expect(count(USER)).toBe(1);
  });
});

describe("bumpAttempts", () => {
  it("increments the retry count for one entry only", () => {
    const first = enqueue(USER, anEntry({ wordId: "first" }));
    enqueue(USER, anEntry({ wordId: "second" }));

    bumpAttempts(USER, first.id);
    bumpAttempts(USER, first.id);

    const items = all(USER);
    expect(items.find((item) => item.id === first.id)?.attempts).toBe(2);
    expect(items.find((item) => item.wordId === "second")?.attempts).toBe(0);
  });

  it("drives the backoff, so it must survive a reload", () => {
    const item = enqueue(USER, anEntry());
    bumpAttempts(USER, item.id);

    // Re-read from storage rather than from memory.
    expect(all(USER)[0].attempts).toBe(1);
  });
});

describe("corrupt or unavailable storage", () => {
  it("treats unparseable storage as an empty queue rather than throwing", () => {
    localStorage.setItem(`hakiya:review-queue:${USER}`, "{not json");
    expect(all(USER)).toEqual([]);
  });

  it("treats a non-array value as empty", () => {
    localStorage.setItem(`hakiya:review-queue:${USER}`, JSON.stringify({ nope: true }));
    expect(all(USER)).toEqual([]);
  });

  it("does not throw when storage refuses to write", () => {
    // Private mode and cross-origin iframes both throw on setItem. Losing the
    // queue is bad; taking the review session down with it is worse.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => enqueue(USER, anEntry())).not.toThrow();
  });

  it("does not throw when storage refuses to read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(all(USER)).toEqual([]);
    expect(count(USER)).toBe(0);
  });

  it("does not throw when clearing is blocked", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => clearForUser(USER)).not.toThrow();
  });
});
