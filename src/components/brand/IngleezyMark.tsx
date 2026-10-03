import { cn } from "@/lib/utils";

/**
 * The Ingleezy mark: the wordmark's ı, a bar with a gold dot over it, drawn
 * inline so the bar inherits `currentColor` and can carry the signature
 * loading pulse — the bar breathes, the dot ticks. This is the brand's
 * ownable loading state (guide §5): a glyph from the name doing the waiting
 * instead of a generic spinner.
 *
 * The dot is always gold, whatever colour the bar takes: it is the one
 * coloured thing in the identity.
 */
export function IngleezyMark({
  className,
  animate = false,
  label,
}: {
  className?: string;
  /** Turn on the loading pulse. Off, it is a static logo glyph. */
  animate?: boolean;
  /** Accessible name; omit for purely decorative uses. */
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 300"
      className={cn("h-8 w-auto", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        cx="50" cy="44" r="36"
        fill="hsl(var(--accent))"
        className={animate ? "animate-mark-dot" : undefined}
      />
      <rect
        x="21" y="112" width="58" height="188" rx="6"
        fill="currentColor"
        className={animate ? "animate-mark-bar" : undefined}
      />
    </svg>
  );
}

/**
 * Full-height centered loading state built on the mark. Drop-in replacement
 * for a page-level spinner.
 */
export function IngleezyLoading({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-[40vh] items-center justify-center", className)}>
      <IngleezyMark animate className="h-12 text-primary" label="جارٍ التحميل" />
    </div>
  );
}
