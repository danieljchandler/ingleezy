import type { ReviewDeckId, ReviewSession } from "@/hooks/useReviewSession";

interface SessionMetaProps {
  deckId: ReviewDeckId;
  session: ReviewSession;
  /** 1-based position within the current deck. */
  position: number;
  /** Cards in the current deck's queue. */
  total: number;
  /** Deck-specific detail appended to the line — a dialect, a save status. */
  children?: React.ReactNode;
}

/**
 * The line under a session's progress bar: which deck this is, how far through
 * it you are, and what is still waiting in the others — so a learner sees the
 * whole day's workload rather than just the slice in front of them.
 *
 * This was `SessionProgress` and drew the bar itself, 1.5 units high, in the
 * page flow. SessionFrame pins the bar now: it is the only thing on a session
 * screen that answers "how much is left", so it is structure rather than trim.
 *
 * The numbers stay here as well as in the bar, and that is not redundant. A
 * bar shows a proportion; only the sentence says whether three cards remain or
 * thirty, which is the difference between finishing and stopping.
 */
export const SessionMeta = ({ deckId, session, position, total, children }: SessionMetaProps) => {
  const elsewhere = session.dueElsewhere(deckId);
  const deckLabel = session.decks.find((deck) => deck.id === deckId)?.label;

  return (
    <>
      {deckLabel} · {position} / {total} مستحقة
      {elsewhere > 0 && ` · ${elsewhere} أخرى في مجموعات ثانية`}
      {children}
    </>
  );
};
