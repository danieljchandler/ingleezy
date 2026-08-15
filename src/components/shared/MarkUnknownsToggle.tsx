import { Button } from "@/components/ui/button";
import { BookmarkPlus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarkUnknowns } from "@/contexts/MarkUnknownsContext";

interface Props {
  className?: string;
}

/**
 * Toggle button for entering "mark unknowns" mode. When enabled,
 * tapping Arabic words in TappableArabicText (and the inline tappable
 * line in Reading Practice) adds them to a batch instead of opening
 * the translation popover. Bulk-saved via SaveUnknownsBar.
 */
export const MarkUnknownsToggle = ({ className }: Props) => {
  const { enabled, setEnabled } = useMarkUnknowns();

  return (
    <Button
      variant={enabled ? "default" : "outline"}
      size="sm"
      className={cn("text-xs gap-1.5", className)}
      // Turning marking off leaves the batch alone. This used to call clear()
      // as well, so a reader who had worked down a passage marking twelve words
      // and tapped the button — reasonably, to stop marking — lost all twelve,
      // with no confirmation and no undo. SaveUnknownsBar shows on the count
      // alone, so the batch survives with its Save and Discard still on screen.
      onClick={() => setEnabled(!enabled)}
    >
      {enabled ? (
        <>
          <Check className="h-3.5 w-3.5" />
          نعلّم
        </>
      ) : (
        <>
          <BookmarkPlus className="h-3.5 w-3.5" />
          علّم اللي ما تعرفه
        </>
      )}
    </Button>
  );
};
