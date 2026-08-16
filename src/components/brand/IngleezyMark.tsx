import { cn } from "@/lib/utils";

/**
 * The Ingleezy mark, drawn inline so it inherits `currentColor` and can carry
 * the signature loading pulse — the exclamation bar breathes, the ya-dot
 * ticks. This is the brand's ownable loading state (guide §5): a bilingual
 * glyph doing the waiting instead of a generic spinner.
 *
 * Two shapes only (no bubble): at spinner sizes the card is noise and the
 * glyph is the identity.
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
      viewBox="0 0 160 300"
      className={cn("h-8 w-auto", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect
        x="53" y="0" width="54" height="150" rx="27"
        fill="currentColor"
        className={animate ? "animate-mark-bar" : undefined}
      />
      <path
        d="M 109 218 C 98 204, 72 203, 60 218 C 51 230, 57 245, 70 249 C 66 257, 58 262, 48 261"
        fill="none" stroke="currentColor" strokeWidth="26"
        strokeLinecap="round" strokeLinejoin="round"
        className={animate ? "animate-mark-dot" : undefined}
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
