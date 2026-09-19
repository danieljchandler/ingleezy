import { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SessionFeedbackProps {
  /** Whether the learner got it. Decides the colour and the icon, nothing else. */
  correct: boolean;
  /** The verdict, in two or three words. */
  title: string;
  /** What the answer was, or why. Optional: a correct answer often needs none. */
  detail?: ReactNode;
  /** Moves to the next item. */
  onContinue: () => void;
  /** Defaults to واصل. */
  continueLabel?: string;
  className?: string;
}

/**
 * The verdict after an answer, in SessionFrame's bottom slot.
 *
 * It takes over the space the action button occupied rather than appearing
 * above it, which is deliberate and mechanical: "continue" then lands under
 * the thumb that just answered, so moving through a session never requires
 * re-aiming. A panel that pushes the button down costs a small aim on every
 * single item, and a session is dozens of items long.
 *
 * Colour is the signal but never the only one — the icon and the words carry
 * it too, so the verdict survives a colour-blind learner and a greyscale
 * screenshot. `--success` and `--destructive` are far enough apart in
 * lightness that they also survive being desaturated.
 */
export function SessionFeedback({
  correct,
  title,
  detail,
  onContinue,
  continueLabel = "واصل",
  className,
}: SessionFeedbackProps) {
  const Icon = correct ? Check : X;

  return (
    <div
      // Polite rather than assertive: the learner has just acted deliberately
      // and is looking at the result, so interrupting them is not warranted.
      role="status"
      className={cn(
        "animate-slide-in-bottom rounded-2xl border p-4",
        correct
          ? "border-success/25 bg-success/10"
          : "border-destructive/25 bg-destructive/10",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <Icon
          className={cn("h-5 w-5 shrink-0", correct ? "text-success" : "text-destructive")}
          aria-hidden
        />
        <span
          className={cn(
            "font-heading text-subtitle font-bold",
            correct ? "text-success" : "text-destructive",
          )}
        >
          {title}
        </span>
      </div>
      {detail && (
        <div className="mb-3 text-body-sm leading-relaxed text-foreground/80">{detail}</div>
      )}
      <button
        type="button"
        onClick={onContinue}
        className={cn(
          "h-12 w-full rounded-xl font-heading text-base font-bold text-white transition-opacity hover:opacity-90",
          correct ? "bg-success" : "bg-destructive",
        )}
      >
        {continueLabel}
      </button>
    </div>
  );
}
