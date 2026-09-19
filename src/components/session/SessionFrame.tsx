import { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SessionFrameProps {
  /** Leaves the session. Always offered: escaping should never need the OS back button. */
  onExit: () => void;
  /** 1-based position in the queue. */
  position: number;
  /** Items in the queue. A total of 0 hides the bar rather than dividing by it. */
  total: number;
  /** Top-end slot: the streak, a session count. One small thing, not a toolbar. */
  trailing?: ReactNode;
  /** A line under the bar — deck name, dialect, an offline notice. */
  meta?: ReactNode;
  /** The card. Vertically centred in whatever room is left. */
  children: ReactNode;
  /** The bottom slot: exactly one primary control. */
  action?: ReactNode;
  /**
   * Replaces `action` when an answer has been judged. It takes the same space
   * on purpose — see SessionFeedback.
   */
  feedback?: ReactNode;
  className?: string;
}

/**
 * The frame every session screen shares: review, quiz, drills, games,
 * pronunciation.
 *
 * Three parts, and only the middle one differs between screens — so a learner
 * moving from a quiz to a pronunciation drill does not have to re-learn where
 * anything is.
 *
 * 1. A pinned top bar. Progress used to be a 6px line sitting in the page
 *    flow, which scrolled away with everything else; it is the only thing on
 *    the screen that answers "how much is left", so it is now structure:
 *    10px, pinned, beside an exit and one trailing slot.
 * 2. The content, centred, with room around it.
 * 3. One action, at the bottom, where a thumb already is.
 *
 * The bottom slot holds `feedback` when there is a verdict and `action`
 * otherwise. They never both show: one action at a time is the whole point.
 */
export function SessionFrame({
  onExit,
  position,
  total,
  trailing,
  meta,
  children,
  action,
  feedback,
  className,
}: SessionFrameProps) {
  const percent = total > 0 ? Math.min(100, Math.max(0, (position / total) * 100)) : 0;

  return (
    <div className={cn("flex min-h-[calc(100dvh-5rem)] flex-col", className)}>
      <header className="flex-shrink-0 pb-3 pt-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            aria-label="إغلاق الجلسة"
            className="-m-2 flex items-center rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
          {total > 0 && (
            <div
              className="h-2.5 flex-grow overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={position}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label="تقدّمك في الجلسة"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-lahja motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          {trailing && <div className="flex flex-shrink-0 items-center">{trailing}</div>}
        </div>
        {meta && (
          <p className="mt-2 text-center text-caption text-muted-foreground">{meta}</p>
        )}
      </header>

      <div className="flex min-h-0 flex-grow flex-col justify-center py-4">{children}</div>

      {(feedback || action) && (
        <div className="flex-shrink-0 pb-2 pt-4">{feedback ?? action}</div>
      )}
    </div>
  );
}
