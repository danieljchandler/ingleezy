import { cn } from "@/lib/utils";

interface TranslationPairProps {
  /** Word-for-word gloss. When absent, only the natural translation renders. */
  literal?: string | null;
  natural: string;
  /** grid = Translate-page two-column layout; compact = natural with a muted literal line under it. */
  variant?: "grid" | "compact";
  className?: string;
}

/**
 * Renders a natural translation optionally paired with its literal
 * (word-for-word) gloss. Old content without a literal field renders
 * exactly as before.
 */
export const TranslationPair = ({
  literal,
  natural,
  variant = "compact",
  className,
}: TranslationPairProps) => {
  const hasLiteral = typeof literal === "string" && literal.trim().length > 0;

  if (variant === "grid") {
    return (
      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          // One column when there is nothing to put in the other. The Literal
          // heading and its paragraph used to render unconditionally, so a
          // translation without a gloss — which is most of the older content —
          // put a heading over an empty half of the Translate page.
          hasLiteral && "sm:grid-cols-2",
          className,
        )}
      >
        {hasLiteral && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
              حرفي
            </p>
            <p className="text-sm text-foreground/80 italic">{literal}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            طبيعي
          </p>
          <p className="text-sm font-medium">{natural}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)} dir="ltr">
      <p className="text-sm text-muted-foreground leading-relaxed">{natural}</p>
      {hasLiteral && (
        <p className="text-xs italic text-muted-foreground/80 leading-relaxed">
          <span className="not-italic uppercase tracking-wide text-[9px] me-1.5 text-muted-foreground/60">
            حرفي
          </span>
          {literal}
        </p>
      )}
    </div>
  );
};
