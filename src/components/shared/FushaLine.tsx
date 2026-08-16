import { cn } from "@/lib/utils";
import { fushaDiffers } from "../../../supabase/functions/_shared/fushaBridge";

interface FushaLineProps {
  /** The line as spoken — what the Fusha rendering is compared against. */
  dialect: string;
  /** The Modern Standard Arabic rendering, if one exists yet. */
  fusha?: string | null;
  /** block = its own labelled row; inline = centred under a subtitle. */
  variant?: "block" | "inline";
  className?: string;
}

/**
 * The Fusha (فصحى) row: the dialect sentence rewritten in Modern Standard
 * Arabic, so a learner who came from Fusha can see what the dialect changed
 * instead of only what it means.
 *
 * It renders nothing without a rendering to show — most content predates the
 * Fusha pass, and an empty labelled row on every line would be worse than no
 * feature. A line that was already Fusha is labelled rather than repeated:
 * showing the identical sentence twice under two headings teaches nothing, and
 * "nothing changed here" is itself the answer a Fusha learner wants.
 */
export const FushaLine = ({
  dialect,
  fusha,
  variant = "block",
  className,
}: FushaLineProps) => {
  const text = fusha?.trim();
  if (!text) return null;

  const changed = fushaDiffers(dialect, text);
  const centred = variant === "inline";

  if (!changed) {
    return (
      <p
        className={cn(
          "text-[10px] uppercase tracking-wide text-muted-foreground/60",
          centred && "text-center",
          className,
        )}
      >
        Already فصحى
      </p>
    );
  }

  // The heading sits above rather than beside the Arabic. Beside it, a label
  // in Latin script next to an RTL sentence lands wherever the bidi algorithm
  // decides, which is not the same place on every line.
  return (
    <div className={cn("space-y-0.5", className)}>
      <p
        className={cn(
          "text-[10px] uppercase tracking-wide text-muted-foreground/60",
          centred ? "text-center" : "text-right",
        )}
      >
        Fusha · فصحى
      </p>
      <p
        className={cn("text-base leading-relaxed text-foreground/75", centred && "text-center")}
        dir="rtl"
      >
        {text}
      </p>
    </div>
  );
};

export default FushaLine;
