import { KEYBOARD_ROWS, normalizeChar } from "@/lib/typingDrills";
import { cn } from "@/lib/utils";

/**
 * On-screen Arabic keyboard, standard 101 layout, base layer.
 *
 * Serves both halves of the trainer: on a phone it IS the keyboard (tap to
 * type), and on a laptop it is the map — the highlighted key shows where the
 * next letter lives on the physical keyboard, with the QWERTY legend in the
 * corner of each cap.
 */
interface ArabicKeyboardProps {
  /** The character to light up as "press this next". */
  highlight?: string;
  onKey?: (char: string) => void;
  className?: string;
}

export const ArabicKeyboard = ({ highlight, onKey, className }: ArabicKeyboardProps) => {
  const target = highlight ? normalizeChar(highlight) : null;

  return (
    <div className={cn("select-none space-y-1", className)} data-testid="arabic-keyboard">
      {KEYBOARD_ROWS.map((row, i) => (
        <div key={i} className="flex justify-center gap-1">
          {row.map((key) => {
            const isNext = target !== null && key.char === target;
            return (
              <button
                key={key.char}
                type="button"
                aria-label={`key ${key.char}`}
                onClick={() => onKey?.(key.char)}
                className={cn(
                  "relative h-11 min-w-0 flex-1 max-w-11 rounded-md border text-lg font-arabic transition-colors",
                  isNext
                    ? "border-primary bg-primary/15 text-primary shadow-sm"
                    : "border-border bg-muted/40 text-foreground hover:bg-muted",
                )}
              >
                {key.char}
                <span className="absolute left-1 top-0.5 text-[9px] uppercase text-muted-foreground">
                  {key.qwerty}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};
