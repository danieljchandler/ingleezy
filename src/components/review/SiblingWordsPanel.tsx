import { useState } from "react";
import { ChevronDown, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiblingWords } from "@/hooks/useSiblingWords";
import { getSRSStageByStability, type SRSStageBreakdown } from "@/lib/srsStats";
import { cn } from "@/lib/utils";

interface SiblingWordsPanelProps {
  root: string | null | undefined;
  currentWordId: string;
  /** The dialect of the card being reviewed — not the app's active dialect. */
  dialect: string;
  onPlayAudio?: (url: string) => void;
  /** Opens the full family. Given the canonical root key. */
  onOpenFamily?: (familyKey: string) => void;
}

/**
 * How well each sibling is remembered, as one dot at six opacities.
 *
 * This replaced four coloured stage badges. Six FSRS buckets do not compress
 * honestly into four colours, and a row of amber and emerald chips beside a
 * flashcard competes with the card for attention — which is exactly what this
 * panel must not do. One `bg-primary` dot carries the same information using
 * tokens the app already has.
 */
const STRENGTH_OPACITY: Record<keyof SRSStageBreakdown, string> = {
  new: "opacity-20",
  learning: "opacity-35",
  familiar: "opacity-50",
  practiced: "opacity-65",
  strong: "opacity-80",
  mastered: "opacity-100",
};

/**
 * Remembered for the session rather than for ever.
 *
 * A learner who opens the list on one card usually wants it open on the next
 * one, but not a week later on a card they have never seen. Module scope gives
 * exactly that lifetime: it survives moving between cards and resets on reload,
 * without spending a preference on it.
 */
let expandedThisSession = false;

/**
 * The other words the learner knows that are built from this card's root.
 *
 * It is deliberately a footnote, not a second card: one muted line under the
 * answer, collapsed, that expands only if asked. The connection between كتب and
 * كتاب is worth offering at the moment of recall and not worth interrupting it
 * for, and anything with its own background and accent colour interrupts.
 */
export const SiblingWordsPanel = ({
  root,
  currentWordId,
  dialect,
  onPlayAudio,
  onOpenFamily,
}: SiblingWordsPanelProps) => {
  const { siblings, total, familyKey, rootDisplay } = useSiblingWords({
    root,
    excludeId: currentWordId,
    dialect,
  });
  const [open, setOpen] = useState(expandedThisSession);

  if (!rootDisplay || total === 0) return null;

  const toggle = () => {
    expandedThisSession = !open;
    setOpen(!open);
  };

  return (
    <div className="mt-6 pt-3 border-t border-border/60 text-left animate-in fade-in duration-300">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-english text-sm">
          {rootDisplay}
        </span>
        <span className="text-left">
          {total === 1
            ? "كلمة واحدة تعرفها من نفس العائلة"
            : total === 2
            ? "كلمتان تعرفهما من نفس العائلة"
            : `${total} كلمات تعرفها من نفس العائلة`}
        </span>
        <ChevronDown
          className={cn("ml-auto h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul className="mt-2 space-y-1 animate-in fade-in duration-200">
          {siblings.map((sibling) => (
            <li key={sibling.id} className="flex items-center gap-2 py-1">
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full bg-primary shrink-0",
                  STRENGTH_OPACITY[
                    getSRSStageByStability(sibling.repetitions, sibling.ease_factor)
                  ],
                )}
              />
              <span className="font-arabic text-base text-foreground/90 shrink-0" dir="rtl">
                {sibling.word_arabic}
              </span>
              <span className="text-xs text-muted-foreground truncate flex-1">
                {sibling.word_english}
              </span>
              {sibling.word_audio_url && onPlayAudio && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => onPlayAudio(sibling.word_audio_url!)}
                  aria-label={`شغّل ${sibling.word_english}`}
                >
                  <Volume2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}

          {total > siblings.length && familyKey && onOpenFamily && (
            <li>
              <button
                type="button"
                onClick={() => onOpenFamily(familyKey)}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                +{total - siblings.length} أخرى
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};
