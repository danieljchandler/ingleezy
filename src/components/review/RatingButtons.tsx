import { cn } from "@/lib/utils";
import { Rating, estimateNextInterval } from "@/lib/spacedRepetition";
import { useDesiredRetention } from "@/hooks/useDesiredRetention";

interface RatingButtonsProps {
  onRate: (rating: Rating) => void;
  stability: number;
  difficulty: number;
  intervalDays: number;
  repetitions: number;
  /** Real days since last review, so the previewed intervals match scheduling. */
  elapsedDays?: number;
  disabled?: boolean;
}

/**
 * The four spaced-repetition ratings, each with the interval it would
 * schedule, so the choice is about when to see the card again rather than
 * about grading oneself.
 */
export const RatingButtons = ({
  onRate,
  stability,
  difficulty,
  intervalDays,
  repetitions,
  elapsedDays,
  disabled,
}: RatingButtonsProps) => {
  // The previewed intervals honour the learner's retention dial. Fuzz is
  // deliberately not previewed: like Anki, the label shows the base interval
  // and the ±5% load balancing lands silently on the stored schedule.
  const desiredRetention = useDesiredRetention();
  // Four pills under the thumb. "Good" is the filled one: it is the answer
  // to most cards, and the one a learner should not have to look for.
  const buttons: { rating: Rating; label: string; color: string }[] = [
    { rating: "again", label: "من جديد", color: "bg-destructive/10 text-destructive hover:bg-destructive/15" },
    { rating: "hard", label: "صعب", color: "bg-accent/15 text-accent-ink hover:bg-accent/25" },
    { rating: "good", label: "جيد", color: "bg-primary text-primary-foreground hover:bg-primary/90" },
    { rating: "easy", label: "سهل", color: "bg-success/10 text-success hover:bg-success/15" },
  ];

  return (
    <div className="mx-auto w-full max-w-md">
      <p className="mb-2.5 text-center text-sm text-muted-foreground">ما مدى تذكّرك لها؟</p>
      <div className="grid grid-cols-4 gap-2">
        {buttons.map(({ rating, label, color }) => {
          const nextInterval = estimateNextInterval(rating, stability, difficulty, intervalDays, repetitions, elapsedDays, {
            desiredRetention,
          });

          return (
            <button
              key={rating}
              type="button"
              onClick={() => onRate(rating)}
              disabled={disabled}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-0.5 rounded-full px-1",
                color,
                "transition-[transform,background-color] duration-150 active:scale-[0.97]",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <span className="text-[15px] font-semibold leading-5">{label}</span>
              <span className="text-xs leading-4 opacity-80">{nextInterval}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
