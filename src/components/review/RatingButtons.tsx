import { cn } from "@/lib/utils";
import { Rating, estimateNextInterval } from "@/lib/spacedRepetition";
import { useDesiredRetention } from "@/hooks/useDesiredRetention";
import { RotateCcw, ThumbsDown, ThumbsUp, Sparkles } from "lucide-react";

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
 * RatingButtons - Spaced repetition rating interface
 * 
 * Clean, minimal design that doesn't overwhelm the learner.
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
  const buttons: { rating: Rating; label: string; icon: React.ReactNode; color: string }[] = [
    {
      rating: 'again',
      label: 'Again',
      icon: <RotateCcw className="w-4 h-4" />,
      color: 'bg-destructive/8 border-destructive/25 text-destructive hover:bg-destructive/12 hover:border-destructive/45',
    },
    {
      rating: 'hard',
      label: 'Hard',
      icon: <ThumbsDown className="w-4 h-4" />,
      color: 'bg-amber-500/8 border-amber-500/25 text-amber-700 hover:bg-amber-500/12 hover:border-amber-500/45',
    },
    {
      rating: 'good',
      label: 'Good',
      icon: <ThumbsUp className="w-4 h-4" />,
      color: 'bg-primary/8 border-primary/25 text-primary hover:bg-primary/12 hover:border-primary/45',
    },
    {
      rating: 'easy',
      label: 'Easy',
      icon: <Sparkles className="w-4 h-4" />,
      color: 'bg-success/10 border-success/30 text-success hover:bg-success/15 hover:border-success/50',
    },
  ];

  return (
    <div className="w-full max-w-sm mx-auto">
      <p className="text-center text-muted-foreground mb-3 text-xs uppercase tracking-wider font-medium">
        How well did you remember?
      </p>
      <div className="grid grid-cols-4 gap-2">
        {buttons.map(({ rating, label, icon, color }) => {
          const nextInterval = estimateNextInterval(rating, stability, difficulty, intervalDays, repetitions, elapsedDays, {
            desiredRetention,
          });

          return (
            <button
              key={rating}
              onClick={() => onRate(rating)}
              disabled={disabled}
              className={cn(
                "flex flex-col items-center justify-center gap-1",
                "py-3 px-2 rounded-xl border-2",
                color,
                "transition-all duration-200",
                "hover:scale-[1.03] hover:-translate-y-0.5 active:scale-[0.97] active:translate-y-0",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {icon}
              <span className="text-xs font-semibold leading-none">{label}</span>
              <span className="text-[10px] opacity-70 leading-none mt-0.5">{nextInterval}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

