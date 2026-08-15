import { formatRoot } from "@/lib/arabicRoot";
import { useRootFamilyPrefs } from "@/hooks/useRootFamilyPrefs";
import { cn } from "@/lib/utils";

interface RootChipProps {
  root: string | null | undefined;
  className?: string;
}

/**
 * A word's Arabic root, rendered as a quiet chip.
 *
 * Curriculum words carry a root now, and this is the one way it is shown —
 * lesson card, quiz, curriculum review, admin word lists. Having a single
 * component means a root looks the same everywhere rather than each surface
 * inventing its own treatment.
 *
 * Renders nothing at all rather than an empty slot when there is no usable
 * root: most curriculum words have none until an admin runs the backfill, and
 * a row of blank chips would be worse than no chips. The same guard filters out
 * the `''` sentinel and any value `rootKey` cannot read, so a root the matcher
 * would refuse is never put in front of a learner.
 */
export const RootChip = ({ root, className }: RootChipProps) => {
  const { enabled } = useRootFamilyPrefs();
  const display = formatRoot(root);

  if (!enabled || !display) return null;

  return (
    <span
      dir="rtl"
      title="الجذر العربي"
      className={cn(
        "inline-block rounded bg-muted px-1.5 py-0.5 font-arabic text-xs text-muted-foreground",
        className,
      )}
    >
      {display}
    </span>
  );
};
