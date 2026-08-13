import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/uiPrefs";
import { useLoadingMessage } from "@/hooks/useLoadingMessage";
import type { LoadingTask } from "@/data/loadingMessages";
import { LoadingEmblem } from "./LoadingEmblem";

/**
 * LoadingPanel — the emblem plus rotating bilingual status copy.
 *
 * This is the shared affordance for the app's long AI waits. Short waits and
 * button-level spinners keep their `Loader2`; a 10s loop that never completes a
 * cycle is worse than a spinner.
 */

export interface LoadingPanelProps {
  /** Which message deck to run. */
  task?: LoadingTask;
  /** "page" centres in the viewport; "inline" sits inside an existing card. */
  variant?: "page" | "inline";
  size?: "sm" | "md" | "lg";
  /** Show a seconds counter once the wait passes this. 0 disables it. */
  showElapsedAfterSeconds?: number;
  /** Stay invisible until the wait has lasted this long, so brief waits stay clean. */
  showAfterMs?: number;
  /** Milliseconds each message is held. */
  intervalMs?: number;
  /** A real progress label. When set it replaces the rotating copy verbatim. */
  statusOverride?: string | null;
  /** Cancel buttons, progress bars, previews — anything the call site owns. */
  children?: ReactNode;
  className?: string;
}

export function LoadingPanel({
  task = "generic",
  variant = "inline",
  size = "md",
  showElapsedAfterSeconds = 5,
  showAfterMs = 600,
  intervalMs,
  statusOverride = null,
  children,
  className,
}: LoadingPanelProps) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(showAfterMs <= 0);
  const { message, index, elapsedSeconds } = useLoadingMessage({
    task,
    intervalMs,
    override: statusOverride,
  });

  useEffect(() => {
    if (showAfterMs <= 0) return;
    const id = setTimeout(() => setVisible(true), showAfterMs);
    return () => clearTimeout(id);
  }, [showAfterMs]);

  if (!visible) return null;

  const showElapsed =
    showElapsedAfterSeconds > 0 && elapsedSeconds >= showElapsedAfterSeconds;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 text-center",
        variant === "page" ? "min-h-[60vh] px-6" : "py-6",
        className,
      )}
    >
      <LoadingEmblem size={size} />

      {/* Keyed on the message so each change re-mounts and fades in. */}
      <div
        key={index}
        className={cn("space-y-1", !reduced && "animate-fade-up")}
      >
        {/*
          Hidden from screen readers on purpose: VoiceOver with an English voice
          reads Arabic as gibberish for most users here, and the English line
          below says the same thing.
        */}
        <p
          dir="rtl"
          lang="ar"
          aria-hidden="true"
          className="text-arabic-body text-foreground/80"
        >
          {message.ar}
        </p>
        <p className="text-t-body text-muted-foreground">{message.en}</p>
        {showElapsed && (
          <p className="text-t-caption text-muted-foreground/70">
            {elapsedSeconds}s
          </p>
        )}
      </div>

      {/*
        One stable announcement rather than aria-live on the rotating copy — a
        110s wait would otherwise fire ~27 announcements at a screen reader.
      */}
      <span role="status" className="sr-only">
        Loading, please wait
      </span>

      {children}
    </div>
  );
}
