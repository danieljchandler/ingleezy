// Ordering for a single SRS review session: how many new cards to admit, and in
// what sequence to present what's left.
//
// This logic used to live inline inside the `queryFn` in MyWordsReview.tsx,
// which meant the curriculum deck (/review) — the app's structured material —
// had no interleaving at all and no new-card cap. It's a pure transformation
// over card rows, so it belongs here where both review pages can use it and
// where it can actually be tested.
//
// Named `reviewOrder` rather than `reviewSession` to stay clearly distinct from
// src/hooks/useReviewSession.ts, which handles a different thing: which *deck*
// the daily session walks into next.

/**
 * Direction a card is being tested in.
 *
 * - `recognition` — see the Arabic, recall the meaning.
 * - `production`  — see the meaning, produce the Arabic. Much harder, and the
 *   direction that actually transfers to speaking.
 * - `audio`       — hear the word, recall the meaning. The most on-mission
 *   direction for a spoken-dialect app.
 */
export type CardDirection = 'recognition' | 'production' | 'audio';

/**
 * The direction a card's schedule is stored under.
 *
 * Narrower than {@link CardDirection}: `audio` and `recognition` test the same
 * mapping (form → meaning) through different input channels, so they share one
 * schedule rather than splitting a word's recognition history in two. Only
 * production, which is a genuinely different and harder skill, gets its own.
 */
export type ScheduleDirection = 'recognition' | 'production';

/** Which schedule a card in this direction reads from and writes back to. */
export function scheduleDirectionFor(direction: CardDirection): ScheduleDirection {
  return direction === 'production' ? 'production' : 'recognition';
}

/** The minimum a card must expose to be ordered. */
export interface SchedulableCard {
  card_type: CardDirection;
  /** Completed reviews in this direction. 0 means the card is new. */
  repetitions: number;
  /** ISO timestamp the card came due, used to prioritise the most overdue. */
  due_at: string;
}

export interface OrderOptions {
  /**
   * Maximum brand-new cards to admit into this session. Review cards are never
   * capped — they're already owed.
   */
  newCardCap: number;
}

/** A card with no completed reviews in its direction. */
export const isNewCard = (card: SchedulableCard): boolean => card.repetitions === 0;

/**
 * Interleave the directions present in `cards` by round-robin.
 *
 * Mixing directions within a session is a deliberate difficulty: it stops the
 * learner settling into one mode and pattern-matching their way through, which
 * is what makes a block of twenty recognition cards feel easy and teach little.
 */
export function interleaveDirections<T extends SchedulableCard>(cards: T[]): T[] {
  const byDirection = new Map<CardDirection, T[]>();
  for (const card of cards) {
    const bucket = byDirection.get(card.card_type);
    if (bucket) bucket.push(card);
    else byDirection.set(card.card_type, [card]);
  }

  // Insertion order of the map follows first appearance in `cards`, which is
  // already sorted by due date — so the most overdue direction leads.
  const buckets = [...byDirection.values()];
  if (buckets.length <= 1) return [...cards];

  const longest = Math.max(...buckets.map((b) => b.length));
  const out: T[] = [];
  for (let i = 0; i < longest; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) out.push(bucket[i]);
    }
  }
  return out;
}

/**
 * Build the ordered card list for one review session.
 *
 * 1. Sort by due date, so the most overdue material is prioritised.
 * 2. Cap new cards, so a large backlog of fresh material can't drown a session.
 * 3. Interleave directions within the new and review groups separately.
 * 4. Round-robin review and new cards together, so reviews don't all clump at
 *    the front and new cards don't all clump at the end.
 *
 * Pure: no mutation of the input array, no clock, no IO.
 */
export function buildReviewOrder<T extends SchedulableCard>(
  cards: T[],
  { newCardCap }: OrderOptions,
): T[] {
  // Compare instants, not strings. due_at arrives from two sources with
  // different serialisations — Postgres timestamptz ("…+00:00") and JS
  // toISOString() ("…Z") — so equal instants would otherwise sort on their
  // punctuation, and any non-UTC offset would sort by wall clock.
  const sorted = [...cards].sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));

  const cap = Math.max(0, newCardCap);
  const newCards = interleaveDirections(sorted.filter(isNewCard)).slice(0, cap);
  const reviewCards = interleaveDirections(sorted.filter((c) => !isNewCard(c)));

  const out: T[] = [];
  const longest = Math.max(newCards.length, reviewCards.length);
  for (let i = 0; i < longest; i++) {
    // Reviews lead: they're the cards with a schedule already owed.
    if (i < reviewCards.length) out.push(reviewCards[i]);
    if (i < newCards.length) out.push(newCards[i]);
  }
  return out;
}
