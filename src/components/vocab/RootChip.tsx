import { formatFamily } from "@/lib/wordFamily";
import { useRootFamilyPrefs } from "@/hooks/useRootFamilyPrefs";
import { cn } from "@/lib/utils";

interface RootChipProps {
  root: string | null | undefined;
  className?: string;
}

/**
 * A word's English word family, rendered as a quiet chip.
 *
 * Curriculum words carry a family now, and this is the one way it is shown —
 * lesson card, quiz, curriculum review, admin word lists. Having a single
 * component means a family looks the same everywhere rather than each surface
 * inventing its own treatment.
 *
 * Renders nothing at all rather than an empty slot when there is no usable
 * family: most curriculum words have none until an admin runs the backfill,
 * and a row of blank chips would be worse than no chips. The same guard
 * filters out the `''` sentinel, any value `familyKey` cannot read, and the
 * Arabic roots left in the column from before the flip — so a family the
 * matcher would refuse is never put in front of a learner.
 */
export const RootChip = ({ root, className }: RootChipProps) => {
  const { enabled } = useRootFamilyPrefs();
  const display = formatFamily(root);

  if (!enabled || !display) return null;

  return (
    <span
      title="عائلة الكلمة"
      className={cn(
        "inline-block rounded bg-muted px-1.5 py-0.5 font-english text-xs text-muted-foreground",
        className,
      )}
    >
      {display}
    </span>
  );
};
