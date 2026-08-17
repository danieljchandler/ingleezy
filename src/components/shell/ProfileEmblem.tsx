import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * The mark, top-start, as the way into your profile.
 *
 * Deliberately not a dock tab. A tab competes with four neighbours and shifts
 * as the bar changes; a corner emblem is in the same place on every screen and
 * never moves, which is what makes it reachable without looking.
 *
 * It is the logo rather than an avatar so the brand earns a job it usually
 * does not get: when something is waiting, the periwinkle ring lights up and
 * the mark becomes a status light. That reads at a glance the way a story ring
 * does, without spending a badge on it.
 */
export function ProfileEmblem({
  hasNews = false,
  className,
}: {
  /** Ring on: something is waiting (due reviews, a new streak day, a reply). */
  hasNews?: boolean;
  className?: string;
}) {
  return (
    <Link
      to="/me"
      data-tour="emblem"
      aria-label={hasNews ? "حسابك — عندك جديد" : "حسابك"}
      className={cn(
        "relative grid h-10 w-10 shrink-0 place-items-center rounded-xl",
        "transition-transform active:scale-95",
        className,
      )}
    >
      {hasNews && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-xl ring-2 ring-periwinkle ring-offset-2 ring-offset-transparent"
        />
      )}
      <img
        src="/brand/ingleezy-icon.svg"
        alt=""
        aria-hidden
        className="h-full w-full"
        draggable={false}
      />
    </Link>
  );
}
