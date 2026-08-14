import type { ReviewDeckId, ReviewSession } from "@/hooks/useReviewSession";

interface SessionProgressProps {
  deckId: ReviewDeckId;
  session: ReviewSession;
  /** 1-based position within the current deck. */
  position: number;
  /** Cards in the current deck's queue. */
  total: number;
  /** Optional deck-specific detail (e.g. a new/review split) shown below. */
  children?: React.ReactNode;
}

/**
 * Progress bar for a review session. Shows position within the current deck
 * plus what's still waiting in the other decks, so the learner can see the
 * whole day's workload rather than just the slice in front of them.
 */
export const SessionProgress = ({
  deckId,
  session,
  position,
  total,
  children,
}: SessionProgressProps) => {
  const percent = total > 0 ? (position / total) * 100 : 0;
  const elsewhere = session.dueElsewhere(deckId);
  const deckLabel = session.decks.find((deck) => deck.id === deckId)?.label;

  return (
    <div className="mb-6">
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-center text-xs text-muted-foreground mt-2">
        {deckLabel} · {position} / {total} مستحقة
        {elsewhere > 0 && ` · ${elsewhere} أخرى في مجموعات ثانية`}
      </p>
      {children}
    </div>
  );
};
