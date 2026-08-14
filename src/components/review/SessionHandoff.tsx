import { useNavigate } from "react-router-dom";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReviewDeckId, ReviewSession } from "@/hooks/useReviewSession";
import { arCount } from "@/lib/strings";

interface SessionHandoffProps {
  /** The deck the learner just finished. */
  deckId: ReviewDeckId;
  session: ReviewSession;
  /** Shown when this deck has nothing due. */
  message: string;
  /** Where "done" goes once every deck is clear. */
  fallbackLabel: string;
  fallbackRoute: string;
  /** Optional extra content (e.g. per-deck stats) above the action button. */
  children?: React.ReactNode;
}

const countCards = (n: number) =>
  arCount(n, { one: "بطاقة واحدة", two: "بطاقتان", few: "بطاقات", many: "بطاقة" });

/**
 * End-of-deck state for a review session. When another deck still has cards
 * due, this offers to continue into it so the learner clears everything due in
 * one sitting instead of dead-ending on "أنجزت كل المراجعات" while cards wait in a
 * deck they'd have to remember to visit.
 */
export const SessionHandoff = ({
  deckId,
  session,
  message,
  fallbackLabel,
  fallbackRoute,
  children,
}: SessionHandoffProps) => {
  const navigate = useNavigate();
  const next = session.nextDeck(deckId);

  return (
    <div className="text-center max-w-sm mx-auto py-12">
      <Trophy className="h-14 w-14 mx-auto mb-6 text-primary" />
      <h1 className="text-xl font-bold text-foreground mb-3">
        {next ? "أنهيت هذه المجموعة" : "أنجزت كل المراجعات!"}
      </h1>
      <p className="text-muted-foreground mb-8">
        {next
          ? `${message} ${countCards(next.due)} ما زالت مستحقة في ${next.label}.`
          : message}
      </p>

      {children}

      {next ? (
        <Button onClick={() => navigate(next.route)}>
          تابع مع {countCards(next.due)} في {next.label}
        </Button>
      ) : (
        <Button onClick={() => navigate(fallbackRoute)}>{fallbackLabel}</Button>
      )}
    </div>
  );
};
