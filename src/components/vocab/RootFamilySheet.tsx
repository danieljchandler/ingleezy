import { Volume2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useRootIndex } from "@/hooks/useRootIndex";
import { getSRSStageByStability, type SRSStageBreakdown } from "@/lib/srsStats";
import { cn } from "@/lib/utils";

interface RootFamilySheetProps {
  /** Canonical root key, or null when closed. */
  familyKey: string | null;
  onOpenChange: (open: boolean) => void;
  onPlayAudio?: (url: string) => void;
}

const STRENGTH_LABEL: Record<keyof SRSStageBreakdown, string> = {
  new: "New",
  learning: "Learning",
  familiar: "Familiar",
  practiced: "Practiced",
  strong: "Strong",
  mastered: "Mastered",
};

const STRENGTH_OPACITY: Record<keyof SRSStageBreakdown, string> = {
  new: "opacity-20",
  learning: "opacity-35",
  familiar: "opacity-50",
  practiced: "opacity-65",
  strong: "opacity-80",
  mastered: "opacity-100",
};

/**
 * Every word the learner knows from one root, in one place.
 *
 * Opened from the footnote under a reviewed card and from a root chip on My
 * Words, so a family looks the same wherever it is reached from. It reads the
 * index already in cache — no query of its own, and nothing to pay for.
 *
 * Dialect is shown rather than filtered here. On the review card the sibling
 * list is scoped to the card's own dialect, because a pattern that only holds
 * in one of them would teach the wrong thing mid-recall; browsing a family is
 * the opposite situation, where seeing that the same root turns up across
 * dialects is the interesting part.
 */
export const RootFamilySheet = ({
  familyKey,
  onOpenChange,
  onPlayAudio,
}: RootFamilySheetProps) => {
  const { data: index } = useRootIndex({ enabled: !!familyKey });
  const words = (familyKey && index?.get(familyKey)) || [];
  const display = familyKey ? familyKey.split("").join(" · ") : "";
  const dialects = new Set(words.map((word) => word.dialect));

  return (
    <Sheet open={!!familyKey} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-arabic text-2xl" dir="rtl">
            {display}
          </SheetTitle>
          <SheetDescription>
            {words.length === 1
              ? "1 word you know is built from this root"
              : `${words.length} words you know are built from this root`}
          </SheetDescription>
        </SheetHeader>

        <ul className="mt-4 divide-y divide-border">
          {words.map((word) => {
            const stage = getSRSStageByStability(word.repetitions, word.ease_factor);
            return (
              <li key={word.id} className="flex items-center gap-3 py-3">
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 rounded-full bg-primary shrink-0",
                    STRENGTH_OPACITY[stage],
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-arabic text-lg text-foreground" dir="rtl">
                    {word.word_arabic}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{word.word_english}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-muted-foreground">{STRENGTH_LABEL[stage]}</p>
                  {dialects.size > 1 && (
                    <p className="text-[10px] text-muted-foreground/70">{word.dialect}</p>
                  )}
                </div>
                {word.word_audio_url && onPlayAudio && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => onPlayAudio(word.word_audio_url!)}
                    aria-label={`شغّل ${word.word_english}`}
                  >
                    <Volume2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
};
