import { useEffect, useMemo, useState } from "react";
import {
  arabicCompanionFor,
  getDeck,
  type LoadingMessage,
  type LoadingTask,
} from "@/data/loadingMessages";

/** How often the clock is sampled. Independent of how often the copy changes. */
const TICK_MS = 1000;

export const DEFAULT_MESSAGE_INTERVAL_MS = 4000;

/**
 * Which message a wait of `elapsedMs` should be showing.
 *
 * Clamps at the last entry rather than wrapping — see the note in
 * `loadingMessages.ts` about why looping back to "Setting up…" reads as a hang.
 *
 * Pure and exported so the scheduling can be tested without React.
 */
export function messageIndexForElapsed(
  elapsedMs: number,
  deckLength: number,
  intervalMs: number,
): number {
  if (!Number.isFinite(deckLength) || deckLength <= 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  return Math.min(Math.floor(elapsedMs / intervalMs), deckLength - 1);
}

export interface UseLoadingMessageOptions {
  /** Rotation only runs while true. Going false → true restarts the deck. */
  active?: boolean;
  task?: LoadingTask;
  intervalMs?: number;
  /**
   * A real, authoritative progress label. When set it supersedes the deck
   * entirely and rotation stops — we don't overwrite honest progress with jokes.
   */
  override?: string | null;
}

export interface UseLoadingMessageResult {
  message: LoadingMessage;
  index: number;
  elapsedSeconds: number;
}

/**
 * Rotating bilingual status copy for a long wait.
 *
 * Both the index and the elapsed counter derive from a single wall-clock start
 * time rather than an incrementing counter. That keeps them from ever
 * disagreeing, and makes background-tab timer throttling harmless: the values
 * snap to the truth on return instead of drifting behind by however long the
 * tab was asleep.
 */
export function useLoadingMessage({
  active = true,
  task = "generic",
  intervalMs = DEFAULT_MESSAGE_INTERVAL_MS,
  override = null,
}: UseLoadingMessageOptions = {}): UseLoadingMessageResult {
  const deck = useMemo(() => getDeck(task), [task]);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), TICK_MS);
    return () => clearInterval(id);
    // `deck` is a stable reference from LOADING_DECKS, so this re-arms only when
    // the task genuinely changes — which is also what resets the rotation for
    // multi-phase screens like LearnFromX (scrape → analyze).
  }, [active, deck, intervalMs]);

  const index = messageIndexForElapsed(elapsedMs, deck.length, intervalMs);

  const message = override
    ? { ar: arabicCompanionFor(override), en: override }
    : deck[index];

  return {
    message,
    index: override ? 0 : index,
    elapsedSeconds: Math.floor(elapsedMs / 1000),
  };
}
