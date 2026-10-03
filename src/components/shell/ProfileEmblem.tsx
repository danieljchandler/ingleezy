import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * The way into your profile, top-start on every tab.
 *
 * Deliberately not a dock tab. A tab competes with four neighbours and shifts
 * as the bar changes; a corner emblem is in the same place on every screen and
 * never moves, which is what makes it reachable without looking.
 *
 * With a name it is an avatar: the first letter on a firoza tint, as the
 * design's header has it. Without one (a page that has not loaded the
 * profile) it is the app-icon tile, so the corner is never empty. When
 * something is waiting, a firoza-mid ring lights up and the emblem becomes a
 * status light, without spending a badge on it.
 */
export function ProfileEmblem({
  name,
  hasNews = false,
  className,
}: {
  /** The learner's display name; its first letter becomes the avatar. */
  name?: string | null;
  /** Ring on: something is waiting (due reviews, a new streak day, a reply). */
  hasNews?: boolean;
  className?: string;
}) {
  const initial = name?.trim().charAt(0);

  return (
    <Link
      to="/me"
      data-tour="emblem"
      aria-label={hasNews ? "حسابك — عندك جديد" : "حسابك"}
      className={cn(
        "relative grid h-11 w-11 shrink-0 place-items-center rounded-full",
        "transition-transform active:scale-95",
        className,
      )}
    >
      {hasNews && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full ring-2 ring-periwinkle ring-offset-2 ring-offset-background"
        />
      )}
      {initial ? (
        <span
          aria-hidden
          className="grid h-full w-full place-items-center rounded-full bg-tint-firoza text-lg font-semibold text-primary dark:text-foreground"
        >
          {initial.toLocaleUpperCase()}
        </span>
      ) : (
        <img
          src="/brand/ingleezy-icon.svg"
          alt=""
          aria-hidden
          className="h-10 w-10"
          draggable={false}
        />
      )}
    </Link>
  );
}
