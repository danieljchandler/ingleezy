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
 *
 * It floats like the dock it replaces on this screen: a white bar inset from
 * the edges, with a mode that is on shown as a firoza pill.
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
      className="fixed inset-x-3 z-40 mx-auto max-w-md sm:inset-x-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
    >
      <div className="grid h-[68px] grid-cols-4 gap-1 rounded-[28px] bg-card p-2 shadow-elegant ring-1 ring-border/60">
        <ToolButton label="كرّر السطر" onClick={onRepeat} disabled={!canRepeat}>
          <Repeat className="h-5 w-5" aria-hidden />
        </ToolButton>
        <ToolButton label="السرعة" onClick={onSpeed} ariaLabel={`السرعة ${speed}×`}>
          <span dir="ltr" className="font-english text-[15px] font-bold leading-5">
            {speed}×
          </span>
        </ToolButton>
        <ToolButton label="وقفة بعد السطر" onClick={onPauseAfterLine} pressed={pauseAfterLine}>
          <Pause className="h-5 w-5" aria-hidden />
        </ToolButton>
        <ToolButton label="قلّدها" onClick={onImitate} pressed={imitating} disabled={!canImitate}>
          <Mic className="h-5 w-5" aria-hidden />
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
        "flex h-full flex-col items-center justify-center gap-0.5 rounded-[20px] text-[12px] leading-4 transition-colors",
        "disabled:opacity-40",
        pressed ? "bg-primary font-semibold text-primary-foreground" : "font-medium text-foreground hover:bg-muted",
      )}
    >
      {children}
      {label}
    </button>
  );
}
