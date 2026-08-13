import { Info } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useFeatureHints } from "@/hooks/useFeatureHints";

interface InfoHintProps {
  title: string;
  body: string;
  className?: string;
  size?: "sm" | "md";
  /** Optional short call-to-action line shown in primary color. */
  cta?: string;
}

/**
 * Small circled (i) icon. Tap to open a friendly popover explaining a
 * feature. Hidden globally when the user disables "Show feature hints"
 * in Settings.
 *
 * Use inline beside a feature title or button. Stops click propagation
 * so it can live inside a clickable tile without triggering it.
 */
export const InfoHint = ({ title, body, className, size = "sm", cta }: InfoHintProps) => {
  const { enabled } = useFeatureHints();
  if (!enabled) return null;

  const iconSize = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const wrapSize = size === "md" ? "h-6 w-6" : "h-5 w-5";

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/*
          A real button, not a span with role="button".

          A span does not synthesise a click from Enter or Space, and Radix's
          `asChild` trigger only composes an onClick — so the handler below,
          which exists to keep those keys off the tile behind the hint, was the
          only thing that happened: the control announced itself as a button,
          took focus, and then did nothing. Every explanation in the app sits
          behind one of these, so the whole feature-hint system was unreachable
          by keyboard and screen reader. A <button> gets the key handling from
          the platform, and the handler goes back to being only a guard.
        */}
        <button
          type="button"
          aria-label={`Learn about ${title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
            }
          }}
          className={cn(
            "inline-flex items-center justify-center rounded-full cursor-pointer",
            "text-muted-foreground/70 hover:text-primary hover:bg-primary/10",
            "transition-colors shrink-0 align-middle",
            wrapSize,
            className
          )}
        >
          <Info className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-64 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-semibold text-foreground mb-1">{title}</p>
        <p className="text-muted-foreground leading-relaxed">{body}</p>
        {cta && <p className="mt-2 text-xs font-medium text-primary">{cta}</p>}
      </PopoverContent>
    </Popover>
  );
};
