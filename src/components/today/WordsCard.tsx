import { Link } from "react-router-dom";
import { useSRSStats } from "@/hooks/useSRSStats";
import { Art } from "@/components/brand/Art";
import { AR } from "@/lib/strings";
import { cn } from "@/lib/utils";

/**
 * Today's second stat tile: how many words are in the learner's cards, and
 * the door to them. It sits beside the streak so the two numbers a learner
 * cares about (how long, how much) are the first thing on the page.
 */
export function WordsCard({ className }: { className?: string }) {
  const { data } = useSRSStats();
  const total = data?.totalCards ?? 0;

  return (
    <Link
      to="/my-words"
      aria-label={`${AR.today.wordsLabel}: ${total}`}
      className={cn(
        "relative flex min-h-[132px] flex-col justify-end overflow-hidden rounded-3xl bg-card p-4 text-foreground no-underline shadow-card",
        "transition-transform active:scale-[0.98]",
        className,
      )}
    >
      <Art name="book" eager className="absolute end-1.5 top-1.5 h-16 w-16" />
      <span className="font-display text-[40px] leading-[44px] tabular-nums">{total}</span>
      <span className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{AR.today.wordsUnit(total)}</span>
      {/* Keeps the baseline level with the streak tile's row of days. */}
      <span aria-hidden className="mt-2.5 h-1.5" />
    </Link>
  );
}
