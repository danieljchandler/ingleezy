import type { ReactNode } from "react";
import { Mic, Pause, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Watch screen's bottom bar: the four things a learner does to one line.
 *
 * They used to be spread over three rows under the video — a speed dropdown,
 * a "continuous / line by line" toggle, a skip pair that only appeared in
 * line mode, and a "practise by imitating" chip repeated on every line. Here
 * each is one thumb-reach button, labelled in words, and the two that are
 * modes say whether they are on (`aria-pressed`).
 */

interface Props {
  speed: number;
  onSpeed: () => void;
  /** Stop at the end of each line instead of playing straight through. */
  pauseAfterLine: boolean;
  onPauseAfterLine: () => void;
  onRepeat: () => void;
  canRepeat: boolean;
  /** Whether the imitation panel is open on the current line. */
  imitating: boolean;
  onImitate: () => void;
  /** False when the current line has no clip to imitate (no timing, no audio). */
  canImitate: boolean;
}

export function WatchToolbar({
  speed,
  onSpeed,
  pauseAfterLine,
  onPauseAfterLine,
  onRepeat,
  canRepeat,
  imitating,
  onImitate,
  canImitate,
}: Props) {
  return (
    <nav
      aria-label="أدوات المقطع"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-2xl grid-cols-4 px-2 pb-1 pt-1.5">
        <ToolButton label="كرّر السطر" onClick={onRepeat} disabled={!canRepeat}>
          <Repeat className="h-[22px] w-[22px]" aria-hidden />
        </ToolButton>
        <ToolButton label="السرعة" onClick={onSpeed} ariaLabel={`السرعة ${speed}×`}>
          <span dir="ltr" className="font-english text-[15px] font-bold leading-[22px]">
            {speed}×
          </span>
        </ToolButton>
        <ToolButton label="وقفة بعد السطر" onClick={onPauseAfterLine} pressed={pauseAfterLine}>
          <Pause className="h-[22px] w-[22px]" aria-hidden />
        </ToolButton>
        <ToolButton label="قلّدها" onClick={onImitate} pressed={imitating} disabled={!canImitate}>
          <Mic className="h-[22px] w-[22px]" aria-hidden />
        </ToolButton>
      </div>
    </nav>
  );
}

function ToolButton({
  label,
  ariaLabel,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  ariaLabel?: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      className={cn(
        "flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[13px] leading-[18px] transition-colors",
        "disabled:opacity-40",
        pressed ? "font-semibold text-primary" : "text-foreground hover:bg-muted",
      )}
    >
      {children}
      {label}
    </button>
  );
}
