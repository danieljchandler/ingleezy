import type { Rating } from "@/lib/spacedRepetition";
import type { ScheduleDirection } from "@/lib/reviewOrder";

export interface QueuedReviewSnapshot {
  id: string;
  ease_factor: number;
  difficulty?: number | null;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  next_review_at: string;
  /** Lapse counters, needed to increment them correctly on a failed rating. */
  lapses?: number | null;
  production_lapses?: number | null;
  /**
   * Production schedule. Absent/null next_review_at means the word hasn't been
   * unlocked for production yet.
   */
  production_ease_factor?: number | null;
  production_difficulty?: number | null;
  production_interval_days?: number | null;
  production_repetitions?: number | null;
  production_last_reviewed_at?: string | null;
  production_next_review_at?: string | null;
}

export interface QueuedRating {
  id: string;
  userId: string;
  wordId: string;
  rating: Rating;
  /**
   * Which schedule this rating updates. Absent on entries queued before
   * directions existed — those are recognition ratings, so the flush treats a
   * missing value as "recognition" rather than dropping them. Writing a rating
   * to the wrong column set silently corrupts a card's schedule, so this is
   * never inferred from anything else.
   */
  direction?: ScheduleDirection;
  currentReview: QueuedReviewSnapshot | null;
  queuedAt: number;
  attempts: number;
}

const KEY_PREFIX = "ingleezy:review-queue:";

const storageKey = (userId: string) => `${KEY_PREFIX}${userId}`;

function safeRead(userId: string): QueuedRating[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(userId: string, items: QueuedRating[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {
    // storage may be blocked in iframes; ignore
  }
}

export function all(userId: string): QueuedRating[] {
  return safeRead(userId);
}

export function enqueue(
  userId: string,
  entry: Omit<QueuedRating, "id" | "userId" | "queuedAt" | "attempts">
): QueuedRating {
  const item: QueuedRating = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId,
    queuedAt: Date.now(),
    attempts: 0,
    ...entry,
  };
  const items = safeRead(userId);
  items.push(item);
  safeWrite(userId, items);
  return item;
}

export function peek(userId: string): QueuedRating | null {
  return safeRead(userId)[0] ?? null;
}

export function remove(userId: string, id: string) {
  safeWrite(
    userId,
    safeRead(userId).filter((it) => it.id !== id)
  );
}

export function bumpAttempts(userId: string, id: string) {
  const items = safeRead(userId);
  const next = items.map((it) =>
    it.id === id ? { ...it, attempts: it.attempts + 1 } : it
  );
  safeWrite(userId, next);
}

export function clearForUser(userId: string) {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // ignore
  }
}

export function count(userId: string): number {
  return safeRead(userId).length;
}
